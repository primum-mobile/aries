// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DitherRasterPattern } from "../render/dither-pattern";
import type { ChartPalette } from "./types";

export const WHEEL_RENDER_STYLE_SCHEMA_VERSION = 1 as const;

export type WheelStyleRevision = string | number;
export type WheelTypographyProfile = "classic" | "compact" | "anglo";
export type WheelGeometryMode = "single" | "comparison";
export type WheelRenderPalette = Omit<
  Readonly<ChartPalette>,
  "aspects" | "planets"
> & {
  readonly aspects: readonly string[];
  readonly planets: readonly string[];
};

/** Paint roles which must remain independently authorable even when their
 * retained application palette fallbacks happen to be the same color. */
export interface WheelElementColors {
  readonly outerMaximumRing: string;
  readonly outerHouseRing: string;
  readonly outerDegreeRing: string;
  readonly zodiacOuterRing: string;
  readonly innerDegreeRing: string;
  readonly zodiacInnerRing: string;
  readonly termRing: string;
  readonly cuspOuterRing: string;
  readonly innerBoundaryRing: string;
  readonly aspectBoundaryRing: string;
  readonly houseBoundaryRing: string;
  readonly angloHouseBoundaryRing: string;
  readonly baseRing: string;
  readonly angloBaseRing: string;
  readonly zodiacSpoke: string;
  readonly houseCusp: string;
  readonly houseLabel: string;
  readonly angloHouseLabel: string;
  readonly termBoundary: string;
  readonly termGlyph: string;
  readonly decanBoundary: string;
  readonly decanGlyph: string;
  readonly bodyLeader: string;
  readonly angloBodyLeader: string;
  readonly outerLeader: string;
  readonly angloOuterLeader: string;
  readonly angleRay: string;
  readonly angleLabel: string;
  readonly surveilAccent: string;
}

type WheelRenderPaletteSpecs = {
  readonly [K in keyof WheelElementColors]: readonly [cssVar: string, fallback: string];
};

export const WHEEL_RENDER_PALETTE_SPECS: Readonly<WheelRenderPaletteSpecs> = deepFreeze({
  outerMaximumRing: ["--aries-wheel-outer-maximum-ring-color", "var(--morinus-frame)"],
  outerHouseRing: ["--aries-wheel-outer-house-ring-color", "var(--morinus-frame)"],
  outerDegreeRing: ["--aries-wheel-outer-degree-ring-color", "var(--morinus-frame)"],
  zodiacOuterRing: ["--aries-wheel-zodiac-outer-ring-color", "var(--morinus-frame)"],
  innerDegreeRing: ["--aries-wheel-inner-degree-ring-color", "var(--morinus-frame)"],
  zodiacInnerRing: ["--aries-wheel-zodiac-inner-ring-color", "var(--morinus-frame)"],
  termRing: ["--aries-wheel-term-ring-color", "var(--morinus-frame)"],
  cuspOuterRing: ["--aries-wheel-cusp-outer-ring-color", "var(--morinus-frame)"],
  innerBoundaryRing: ["--aries-wheel-inner-boundary-ring-color", "var(--morinus-frame)"],
  aspectBoundaryRing: ["--aries-wheel-aspect-boundary-ring-color", "var(--morinus-frame)"],
  houseBoundaryRing: ["--aries-wheel-house-boundary-ring-color", "var(--morinus-houses)"],
  angloHouseBoundaryRing: ["--aries-wheel-anglo-house-boundary-ring-color", "var(--morinus-frame)"],
  baseRing: ["--aries-wheel-base-ring-color", "var(--morinus-angles)"],
  angloBaseRing: ["--aries-wheel-anglo-base-ring-color", "var(--morinus-frame)"],
  zodiacSpoke: ["--aries-wheel-zodiac-spoke-color", "var(--morinus-frame)"],
  houseCusp: ["--aries-wheel-house-cusp-color", "var(--morinus-houses)"],
  houseLabel: ["--aries-wheel-house-label-color", "var(--morinus-housenums)"],
  angloHouseLabel: ["--aries-wheel-anglo-house-label-color", "var(--morinus-text-dim)"],
  termBoundary: ["--aries-wheel-term-boundary-color", "var(--morinus-frame)"],
  termGlyph: ["--aries-wheel-term-glyph-color", "var(--morinus-signs)"],
  decanBoundary: ["--aries-wheel-decan-boundary-color", "var(--morinus-frame)"],
  decanGlyph: ["--aries-wheel-decan-glyph-color", "var(--morinus-signs)"],
  bodyLeader: ["--aries-wheel-body-leader-color", "var(--morinus-frame)"],
  angloBodyLeader: ["--aries-wheel-anglo-body-leader-color", "var(--morinus-angles)"],
  outerLeader: ["--aries-wheel-outer-leader-color", "var(--morinus-frame)"],
  angloOuterLeader: ["--aries-wheel-anglo-outer-leader-color", "var(--morinus-angles)"],
  angleRay: ["--aries-wheel-angle-ray-color", "var(--morinus-angles)"],
  angleLabel: ["--aries-wheel-angle-label-color", "var(--morinus-angles)"],
  surveilAccent: ["--aries-wheel-surveil-accent-color", "rgb(229,146,70)"],
});

export interface WheelRingSet {
  readonly r30: number;
  readonly rOuter0: number;
  readonly rOuter1: number;
  readonly rOuter5: number;
  readonly rOuter10: number;
  readonly rOuterLine: number;
  readonly rAntis: number;
  readonly rAntisLines: number;
  readonly rSign: number;
  readonly r0: number;
  readonly r1: number;
  readonly r5: number;
  readonly r10: number;
  readonly rASCMC: number;
  readonly rArrow: number;
  readonly rTerms: number;
  readonly rTermsPlanet: number;
  readonly rDecans: number;
  readonly rDecansPlanet: number;
  readonly rInner: number;
  readonly rLLine: number;
  readonly rLLine2: number;
  readonly rRetr: number;
  readonly rPlanet: number;
  readonly rAsp: number;
  readonly rPos: number;
  readonly rAspAscMC: number;
  readonly rPosAscMC: number;
  readonly rPosHouses: number;
  readonly rBase: number;
  readonly rHouse: number;
  readonly rHouseName: number;
  readonly rPosDeg?: number;
  readonly rPosMin?: number;
  readonly rPosAscMCMin?: number;
  readonly rPosHousesMin?: number;
  readonly rCuspOuter?: number;
  readonly rCuspLabelOuter?: number;
  readonly rCuspLabel?: number;
  readonly rOuterMax?: number;
  readonly rOuterHouse?: number;
  readonly rOuterHouseName?: number;
  readonly rOuterPlanet?: number;
  readonly rOuterASCMC?: number;
  readonly rOuterArrow?: number;
  readonly rOuterRetr?: number;
  readonly rOuterMin?: number;
}

export interface WheelPositionLane {
  readonly position: number;
  readonly aspectAngle: number;
  readonly positionAngle: number;
  readonly positionHouses: number;
}

export interface ClassicWheelGeometryProfile {
  readonly degreeTickLength: number;
  readonly signSectorLength: number;
  readonly planetSectorLength: number;
  readonly termSectorLength: number;
  readonly decanSectorLength: number;
  readonly planetLineLength: number;
  readonly retrogradeOffset: number;
  readonly arrowLength: number;
  readonly houseSectorLength: number;
  readonly outer: Readonly<{
    zodiac: number;
    line: number;
    projectedLabel: number;
    projectedLine: number;
  }>;
  readonly inner: Readonly<{
    position: number;
    aspectAngle: number;
    positionAngle: number;
    positionHouses: number;
    base: number;
    houseName: number;
  }>;
  readonly singlePositionLanes: readonly [WheelPositionLane, WheelPositionLane, WheelPositionLane];
  readonly comparisonPositionLanes: readonly [WheelPositionLane, WheelPositionLane, WheelPositionLane];
}

export interface CompactWheelGeometryProfile {
  readonly positionLaneSingle: readonly [number, number, number];
  readonly positionLaneComparison: readonly [number, number, number];
  readonly positionInset: number;
  readonly positionMinuteInsetSingle: number;
  readonly positionMinuteInsetWithOuter: number;
  readonly positionMinuteInsetComparison: number;
  readonly retrogradeInset: number;
  readonly base: number;
  readonly houseSector: number;
  readonly houseName: number;
  readonly densityOffsetWithPositions: readonly [number, number, number, number];
  readonly densityOffsetWithoutPositions: readonly [number, number, number, number];
}

export interface AngloWheelGeometryProfile {
  readonly zodiacSingle: number;
  readonly zodiacWithOuter: number;
  readonly zodiacComparisonWithHouses: number;
  readonly subdivisionSector: number;
  readonly signInnerScale: number;
  readonly rulerBaseScale: number;
  readonly rulerSubdivisionScale: number;
  readonly cuspLabelScale: number;
  readonly innerScale: number;
  readonly planetScale: number;
  readonly aspectScale: number;
  readonly houseScale: number;
  readonly leaderInsetScale: number;
  readonly aspectLeaderInsetScale: number;
  readonly retrogradeInsetScale: number;
  readonly positionInsetScale: number;
  readonly anglePositionScale: number;
  readonly houseCuspTickScale: number;
  readonly angleRulerTickScale: number;
  readonly cuspRulerTicks: Readonly<{
    short: number;
    medium: number;
    long: number;
  }>;
  readonly degreeTickLength: number;
  readonly noOuterLineOffset: number;
  readonly arrowInset: number;
  readonly arrowMaximum: number;
  readonly outerSingle: Readonly<{
    degree0: number;
    degree1: number;
    degree5: number;
    degree10: number;
    line: number;
    projectedLabel: number;
    angle: number;
    arrow: number;
  }>;
  readonly comparisonNoHouses: Readonly<{
    planet: number;
    angle: number;
    arrow: number;
    retrograde: number;
    minute: number;
  }>;
  readonly comparisonWithHouses: Readonly<{
    degree0: number;
    degree1: number;
    degree5: number;
    degree10: number;
    max: number;
    house: number;
    houseName: number;
    planet: number;
    line: number;
    projectedLabel: number;
    retrograde: number;
  }>;
}

export interface BiwheelGeometryProfile {
  readonly outerMax: number;
  readonly outerHouseSector: number;
  readonly zodiacInset: number;
  readonly outerPlanetSector: number;
  readonly outerAngle: number;
  readonly arrowLength: number;
  readonly outerLineOffset: number;
  readonly projectedLabel: number;
  readonly retrogradeOffset: number;
  readonly outerMinimum: number;
}

export interface WheelGeometryProfiles {
  readonly classic: ClassicWheelGeometryProfile;
  readonly compact: CompactWheelGeometryProfile;
  readonly anglo: AngloWheelGeometryProfile;
  readonly biwheel: BiwheelGeometryProfile;
}

export interface WheelGeometryInput {
  readonly profile: WheelTypographyProfile;
  readonly mode: WheelGeometryMode;
  readonly maxRadius: number;
  readonly hasOuterRing: boolean;
  readonly showTerms: boolean;
  readonly showDecans: boolean;
  readonly showHouses: boolean;
  readonly showPositions: boolean;
  readonly comparisonWithOuterHouses: boolean;
  readonly restrainedAngloComparison?: boolean;
}

export interface WheelTypographyRatios {
  readonly body: number;
  readonly outer: Readonly<Record<WheelTypographyProfile, number>>;
  readonly sign: Readonly<Record<WheelTypographyProfile, number>>;
  readonly subdivision: Readonly<Record<WheelTypographyProfile, number>>;
  readonly termGlyphScale: number;
  readonly decanGlyphScale: number;
  readonly angleLabelScale: number;
  readonly angleLabelWeight: number;
  readonly syzygyScale: number;
  readonly houseLabelScale: number;
  readonly bodyPosition: Readonly<{
    degreeScale: number;
    signScale: number;
    minuteScale: number;
  }>;
  readonly anglePosition: Readonly<{
    degreeScale: number;
    signScale: number;
    minuteScale: number;
  }>;
  readonly housePosition: Readonly<{
    degreeScale: number;
    signScale: number;
    minuteScale: number;
  }>;
  readonly aspectGlyphScale: number;
  readonly aspectGlyphOffsetScale: number;
  readonly motionScale: number;
  readonly outerLabelScale: number;
  readonly outerProjectedGlyphScale: number;
  readonly angloBodyPosition: Readonly<{
    degreeRadiusOffset: number;
    degreeScale: number;
    signRadiusOffset: number;
    signScale: number;
    minuteRadiusOffset: number;
    minuteScale: number;
  }>;
  readonly angloAnglePosition: Readonly<{
    degreeScale: number;
    signScale: number;
    minuteScale: number;
    gapScale: number;
  }>;
  readonly angloHousePosition: Readonly<{
    degreeScale: number;
    signScale: number;
    minuteScale: number;
    gapScale: number;
  }>;
  readonly fallbackMeasureWidthScale: number;
}

export interface WheelTypographyStyle {
  readonly families: {
    readonly ui: string;
    readonly symbols: string;
    readonly bodySymbols: string;
    readonly signSymbols: string;
    readonly termSymbols: string;
    readonly decanSymbols: string;
    readonly aspectSymbols: string;
  };
  readonly ratios: WheelTypographyRatios;
}

export interface WheelStrokeStyle {
  readonly referenceSize: number;
  readonly mediumBase: number;
  readonly hairline: number;
  readonly angloStructural: number;
  readonly degreeTick: {
    readonly breakpoint: number;
    readonly small: number;
    readonly large: number;
  };
  readonly ascMcDefaultBase: number;
  readonly chartRing: Readonly<{
    fallbackBase: number;
    minBase: number;
    maxBase: number;
  }>;
  readonly arrows: Readonly<{
    halfAngleDegrees: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    angloBaseInsetScale: number;
    angloHalfAngleDegrees: number;
  }>;
  readonly aspects: Readonly<{
    classicWidth: number;
    angloWidth: number;
    classicDash: readonly [number, number];
    angloDash: readonly [number, number];
    classicThicknessMax: number;
    classicThicknessMin: number;
    classicThicknessNoOrb: number;
    angloThicknessMin: number;
    angloThicknessSpan: number;
    angloThicknessNoOrb: number;
    classicOpacityMin: number;
    classicOpacitySpan: number;
    angloOpacityMin: number;
    angloOpacitySpan: number;
  }>;
}

export const WHEEL_LINE_PAINT_ROLES = [
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
] as const;

export type WheelLinePaintRole = (typeof WHEEL_LINE_PAINT_ROLES)[number];

export const WHEEL_PAINTED_RING_ROLES = [
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
] as const;

export type WheelPaintedRingRole = (typeof WHEEL_PAINTED_RING_ROLES)[number];
export type WheelRingRadiusTokenKey =
  `${WheelTypographyProfile}${Capitalize<WheelPaintedRingRole>}Radius`;
export type WheelRingRadiusOverrides = Readonly<
  Record<
    WheelTypographyProfile,
    Readonly<Record<WheelPaintedRingRole, number>>
  >
>;

export const WHEEL_AUTHORING_TYPOGRAPHY_CLASSES = [
  "zodiac.signGlyph",
  "subdivisions.term.glyph",
  "subdivisions.decan.glyph",
  "houses.inner.label",
  "houses.inner.position.degree",
  "houses.inner.position.sign",
  "houses.inner.position.minute",
  "houses.outer.label",
  "angles.inner.label",
  "angles.inner.position.degree",
  "angles.inner.position.sign",
  "angles.inner.position.minute",
  "angles.outer.label",
  "bodies.inner.glyph",
  "bodies.inner.motion",
  "bodies.inner.position.degree",
  "bodies.inner.position.sign",
  "bodies.inner.position.minute",
  "bodies.outer.glyph",
  "bodies.outer.motion",
  "bodies.fortune",
  "bodies.vertex",
  "bodies.prenatalSyzygy",
  "aspects.primary.glyph",
  "aspects.interchart.glyph",
  "secondaryRing.fixedStar.label",
  "secondaryRing.asteroid.label",
  "secondaryRing.midpoint.glyph",
  "secondaryRing.midpoint.text",
  "secondaryRing.hybridHit.label",
  "secondaryRing.antiscia.glyph",
  "secondaryRing.antiscia.text",
  "secondaryRing.contraAntiscia.glyph",
  "secondaryRing.contraAntiscia.text",
  "secondaryRing.dodecatemoria.glyph",
  "secondaryRing.dodecatemoria.text",
  "secondaryRing.arabicPart.label",
  "secondaryRing.parallelTransit.glyph",
  "secondaryRing.parallelTransit.motion",
  "surveil.marker.glyph",
  "surveil.marker.label",
  "surveil.sourceLabel",
  "chartOverlay.information.topLeft",
  "chartOverlay.information.bottomLeft",
  "chartOverlay.houseSystem.bottomRight",
  "chartOverlay.events.dayHour.label",
  "chartOverlay.events.dayHour.glyph",
  "chartOverlay.events.dayHour.trailing",
  "chartOverlay.events.header.label",
  "chartOverlay.events.header.glyph",
  "chartOverlay.events.header.trailing",
  "chartOverlay.events.signal.label",
  "chartOverlay.events.signal.glyph",
  "chartOverlay.events.signal.trailing",
] as const;

export type WheelAuthoringTypographyClass =
  (typeof WHEEL_AUTHORING_TYPOGRAPHY_CLASSES)[number];

/** Profile-v2 stroke targets stay at semantic class granularity. */
export const WHEEL_AUTHORING_LINE_CLASSES = [
  "rings.outerMaximum",
  "rings.outerHouse",
  "rings.outerDegree",
  "rings.zodiacOuter",
  "rings.innerDegree",
  "rings.zodiacInner",
  "rings.term",
  "rings.angloCuspOuter",
  "rings.innerBoundary",
  "rings.aspectBoundary",
  "rings.houseBoundary",
  "rings.base",
  "zodiac.spoke",
  "zodiac.tick.inner.10deg",
  "zodiac.tick.inner.5deg",
  "zodiac.tick.inner.1deg",
  "zodiac.tick.outer.10deg",
  "zodiac.tick.outer.5deg",
  "zodiac.tick.outer.1deg",
  "zodiac.tick.angloCuspRuler.10deg",
  "zodiac.tick.angloCuspRuler.5deg",
  "zodiac.tick.angloCuspRuler.1deg",
  "zodiac.tick.angloHouseCusp",
  "zodiac.tick.angloAngleRuler",
  "subdivisions.term.boundary",
  "subdivisions.decan.boundary",
  "houses.inner.cusp",
  "houses.outer.cusp",
  "angles.inner.ray",
  "angles.inner.arrowhead",
  "angles.outer.ray",
  "angles.outer.arrowhead",
  "bodies.inner.leader",
  "bodies.outer.leader",
  "aspects.primary.line",
  "aspects.interchart.line",
  "aspects.interchart.endpointMarker",
  "secondaryRing.fixedStar.leader",
  "secondaryRing.asteroid.leader",
  "secondaryRing.midpoint.leader",
  "secondaryRing.hybridHit.leader",
  "secondaryRing.antiscia.leader",
  "secondaryRing.contraAntiscia.leader",
  "secondaryRing.dodecatemoria.leader",
  "secondaryRing.arabicPart.leader",
  "secondaryRing.parallelTransit.leader",
  "surveil.tick",
] as const;

export type WheelAuthoringLineClass =
  (typeof WHEEL_AUTHORING_LINE_CLASSES)[number];

export const WHEEL_CHART_OVERLAY_CLASSES = [
  "chartOverlay.information.topLeft",
  "chartOverlay.information.bottomLeft",
  "chartOverlay.houseSystem.bottomRight",
  "chartOverlay.events.dayHour.label",
  "chartOverlay.events.dayHour.glyph",
  "chartOverlay.events.dayHour.trailing",
  "chartOverlay.events.header.label",
  "chartOverlay.events.header.glyph",
  "chartOverlay.events.header.trailing",
  "chartOverlay.events.signal.label",
  "chartOverlay.events.signal.glyph",
  "chartOverlay.events.signal.trailing",
] as const;

export type WheelChartOverlayClass =
  (typeof WHEEL_CHART_OVERLAY_CLASSES)[number];

export type WheelSecondaryRingClassIds = Readonly<{
  leader: WheelAuthoringLineClass;
  label?: WheelAuthoringTypographyClass;
  glyph?: WheelAuthoringTypographyClass;
  text?: WheelAuthoringTypographyClass;
  motion?: WheelAuthoringTypographyClass;
}>;

const WHEEL_SECONDARY_RING_CLASS_IDS = deepFreeze({
  fixedStar: {
    leader: "secondaryRing.fixedStar.leader",
    label: "secondaryRing.fixedStar.label",
  },
  asteroid: {
    leader: "secondaryRing.asteroid.leader",
    label: "secondaryRing.asteroid.label",
  },
  midpoint: {
    leader: "secondaryRing.midpoint.leader",
    glyph: "secondaryRing.midpoint.glyph",
    text: "secondaryRing.midpoint.text",
  },
  hybridHit: {
    leader: "secondaryRing.hybridHit.leader",
    label: "secondaryRing.hybridHit.label",
  },
  antiscia: {
    leader: "secondaryRing.antiscia.leader",
    glyph: "secondaryRing.antiscia.glyph",
    text: "secondaryRing.antiscia.text",
  },
  contraAntiscia: {
    leader: "secondaryRing.contraAntiscia.leader",
    glyph: "secondaryRing.contraAntiscia.glyph",
    text: "secondaryRing.contraAntiscia.text",
  },
  dodecatemoria: {
    leader: "secondaryRing.dodecatemoria.leader",
    glyph: "secondaryRing.dodecatemoria.glyph",
    text: "secondaryRing.dodecatemoria.text",
  },
  arabicPart: {
    leader: "secondaryRing.arabicPart.leader",
    label: "secondaryRing.arabicPart.label",
  },
  parallelTransit: {
    leader: "secondaryRing.parallelTransit.leader",
    glyph: "secondaryRing.parallelTransit.glyph",
    motion: "secondaryRing.parallelTransit.motion",
  },
} satisfies Record<string, WheelSecondaryRingClassIds>);

/**
 * Resolve daemon outer-ring family spelling to the one semantic class set
 * shared by production paint and the Style Lab scene.
 */
export function resolveWheelSecondaryRingClassIds(
  family: string,
): WheelSecondaryRingClassIds | null {
  const normalized = family.trim().toLowerCase().replaceAll("-", "_");
  if (normalized.includes("fixed")) return WHEEL_SECONDARY_RING_CLASS_IDS.fixedStar;
  if (normalized.includes("asteroid")) return WHEEL_SECONDARY_RING_CLASS_IDS.asteroid;
  if (normalized.includes("midpoint")) return WHEEL_SECONDARY_RING_CLASS_IDS.midpoint;
  if (normalized.includes("hybrid")) return WHEEL_SECONDARY_RING_CLASS_IDS.hybridHit;
  if (normalized.includes("contra") && normalized.includes("antis")) {
    return WHEEL_SECONDARY_RING_CLASS_IDS.contraAntiscia;
  }
  if (normalized.includes("antis")) return WHEEL_SECONDARY_RING_CLASS_IDS.antiscia;
  if (normalized.includes("dodec")) return WHEEL_SECONDARY_RING_CLASS_IDS.dodecatemoria;
  if (normalized.includes("arab") || normalized === "lot") {
    return WHEEL_SECONDARY_RING_CLASS_IDS.arabicPart;
  }
  if (normalized.includes("parallel")) {
    return WHEEL_SECONDARY_RING_CLASS_IDS.parallelTransit;
  }
  return null;
}

/** Frame-invariant regions painted on the retained fill canvas. */
export const WHEEL_AUTHORING_FILL_CLASSES = [
  "canvas.background",
  "fills.chartField",
  "fills.houseField",
  "fills.centerField",
  "fills.zodiacBand",
  "fills.subdivisionBand",
] as const;

export type WheelAuthoringFillClass =
  (typeof WHEEL_AUTHORING_FILL_CLASSES)[number];

export type WheelAuthoringFillPattern =
  | "none"
  | "solid"
  | "paper"
  | "hatch"
  | "crosshatch"
  | "scanline"
  | DitherRasterPattern;

export type WheelAuthoringGradientType = "none" | "linear" | "radial";
export type WheelAuthoringDirectionSource = "fixed" | "sun";
export type WheelAuthoringTextureMask = "none" | "crescent";

export type WheelAuthoringFillPaintOverride = Readonly<{
  fillPattern?: WheelAuthoringFillPattern;
  cellSizePx?: number;
  dotSizePx?: number;
  backgroundColor?: string;
  patternColor?: string;
  gradientType?: WheelAuthoringGradientType;
  gradientDirection?: WheelAuthoringDirectionSource;
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientAngle?: number;
  textureMask?: WheelAuthoringTextureMask;
  maskDirection?: WheelAuthoringDirectionSource;
  maskAngle?: number;
  maskAmount?: number;
  shadowPattern?: WheelAuthoringFillPattern;
  shadowColor?: string;
  shadowXpx?: number;
  shadowYpx?: number;
  shadowBlurPx?: number;
  opacity?: number;
  density?: number;
  angle?: number;
  seed?: number;
}>;

export type ResolvedWheelFillPaint = Readonly<{
  fillPattern: WheelAuthoringFillPattern;
  cellSizePx: number;
  dotSizePx: number;
  backgroundColor: string;
  backgroundEnabled: boolean;
  patternColor: string;
  gradientType: WheelAuthoringGradientType;
  gradientDirection: WheelAuthoringDirectionSource;
  gradientStartColor: string;
  gradientEndColor: string;
  gradientAngle: number;
  textureMask: WheelAuthoringTextureMask;
  maskDirection: WheelAuthoringDirectionSource;
  maskAngle: number;
  maskAmount: number;
  shadowPattern: WheelAuthoringFillPattern;
  shadowColor: string;
  shadowXpx: number;
  shadowYpx: number;
  shadowBlurPx: number;
  opacity: number;
  density: number;
  angle: number;
  seed: number;
}>;

export type WheelAuthoringStrokeStyle =
  | "renderer"
  | "solid"
  | "dashed"
  | "dotted";

/**
 * Portable font identity carried by profile-v2. The renderer consumes
 * `cssFamily`; the remaining fields keep exports deterministic and allow the
 * daemon to validate bundled/local/asset provenance without reducing a font
 * choice to an untyped CSS string.
 */
export type WheelAuthoringFontRef = Readonly<{
  role: "text" | "symbols";
  source: "bundled" | "local" | "asset" | "generic";
  family: readonly string[];
  cssFamily: string;
  style: string;
  weight: number;
  postscriptName?: string;
  assetId?: string;
  variationAxes?: Readonly<Record<string, number>>;
}>;

export type WheelAuthoringTypographyOverride = Readonly<{
  fontRef?: WheelAuthoringFontRef;
  /** Final font size at the profile-v2 reference radius. */
  fontSizePx?: number;
  /** Final letter spacing at the profile-v2 reference radius. */
  trackingPx?: number;
  color?: string;
  opacity?: number;
}>;

export type WheelAuthoringLinePaintOverride = Readonly<{
  /** Final stroke width at the profile-v2 reference radius, never a multiplier. */
  strokeWidthPx?: number;
  strokeStyle?: WheelAuthoringStrokeStyle;
  dashOnPx?: number;
  dashOffPx?: number;
  color?: string;
  opacity?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
}>;

/**
 * Sparse profile-v2 values. Every dimension is a direct chart-pixel value on
 * the declared reference radius. Variant inheritance is resolved before this
 * renderer contract is created.
 */
export type WheelAuthoringOverrides = Readonly<{
  referenceRadius: number;
  typography: Readonly<
    Partial<
      Record<
        WheelTypographyProfile,
        Readonly<
          Partial<
            Record<WheelAuthoringTypographyClass, WheelAuthoringTypographyOverride>
          >
        >
      >
    >
  >;
  linePaint: Readonly<
    Partial<
      Record<
        WheelTypographyProfile,
        Readonly<Partial<Record<WheelAuthoringLineClass, WheelAuthoringLinePaintOverride>>>
      >
    >
  >;
  fillPaint: Readonly<
    Partial<
      Record<
        WheelTypographyProfile,
        Readonly<Partial<Record<WheelAuthoringFillClass, WheelAuthoringFillPaintOverride>>>
      >
    >
  >;
  ringRadii: Readonly<
    Partial<
      Record<
        WheelTypographyProfile,
        Readonly<Partial<Record<WheelPaintedRingRole, number>>>
      >
    >
  >;
}>;

const WHEEL_RING_RADIUS_CSS_VARS: Readonly<
  Record<
    WheelTypographyProfile,
    Readonly<Record<WheelPaintedRingRole, string>>
  >
> = deepFreeze({
  classic: {
    outerMaximumRing: "--aries-wheel-classic-outer-maximum-ring-radius",
    outerHouseRing: "--aries-wheel-classic-outer-house-ring-radius",
    outerDegreeRing: "--aries-wheel-classic-outer-degree-ring-radius",
    zodiacOuterRing: "--aries-wheel-classic-zodiac-outer-ring-radius",
    innerDegreeRing: "--aries-wheel-classic-inner-degree-ring-radius",
    zodiacInnerRing: "--aries-wheel-classic-zodiac-inner-ring-radius",
    termRing: "--aries-wheel-classic-term-ring-radius",
    cuspOuterRing: "--aries-wheel-classic-cusp-outer-ring-radius",
    innerBoundaryRing: "--aries-wheel-classic-inner-boundary-ring-radius",
    aspectBoundaryRing: "--aries-wheel-classic-aspect-boundary-ring-radius",
    houseBoundaryRing: "--aries-wheel-classic-house-boundary-ring-radius",
    baseRing: "--aries-wheel-classic-base-ring-radius",
  },
  compact: {
    outerMaximumRing: "--aries-wheel-compact-outer-maximum-ring-radius",
    outerHouseRing: "--aries-wheel-compact-outer-house-ring-radius",
    outerDegreeRing: "--aries-wheel-compact-outer-degree-ring-radius",
    zodiacOuterRing: "--aries-wheel-compact-zodiac-outer-ring-radius",
    innerDegreeRing: "--aries-wheel-compact-inner-degree-ring-radius",
    zodiacInnerRing: "--aries-wheel-compact-zodiac-inner-ring-radius",
    termRing: "--aries-wheel-compact-term-ring-radius",
    cuspOuterRing: "--aries-wheel-compact-cusp-outer-ring-radius",
    innerBoundaryRing: "--aries-wheel-compact-inner-boundary-ring-radius",
    aspectBoundaryRing: "--aries-wheel-compact-aspect-boundary-ring-radius",
    houseBoundaryRing: "--aries-wheel-compact-house-boundary-ring-radius",
    baseRing: "--aries-wheel-compact-base-ring-radius",
  },
  anglo: {
    outerMaximumRing: "--aries-wheel-anglo-outer-maximum-ring-radius",
    outerHouseRing: "--aries-wheel-anglo-outer-house-ring-radius",
    outerDegreeRing: "--aries-wheel-anglo-outer-degree-ring-radius",
    zodiacOuterRing: "--aries-wheel-anglo-zodiac-outer-ring-radius",
    innerDegreeRing: "--aries-wheel-anglo-inner-degree-ring-radius",
    zodiacInnerRing: "--aries-wheel-anglo-zodiac-inner-ring-radius",
    termRing: "--aries-wheel-anglo-term-ring-radius",
    cuspOuterRing: "--aries-wheel-anglo-cusp-outer-ring-radius",
    innerBoundaryRing: "--aries-wheel-anglo-inner-boundary-ring-radius",
    aspectBoundaryRing: "--aries-wheel-anglo-aspect-boundary-ring-radius",
    houseBoundaryRing: "--aries-wheel-anglo-house-boundary-ring-radius",
    baseRing: "--aries-wheel-anglo-base-ring-radius",
  },
});
export type WheelLinePattern = 0 | 1 | 2 | 3;

export interface WheelLinePaintRoleStyle {
  readonly widthScale: number;
  /** 0 keeps renderer semantics; 1 solid; 2 dashed; 3 dotted. */
  readonly pattern: WheelLinePattern;
  readonly dashOn: number;
  readonly dashOff: number;
  readonly opacity: number;
}

export type WheelLinePaintStyle = Readonly<
  Record<WheelLinePaintRole, Readonly<WheelLinePaintRoleStyle>>
>;

export type WheelLinePaintTokenSuffix =
  | "WidthScale"
  | "Pattern"
  | "DashOn"
  | "DashOff"
  | "Opacity";

export type WheelLinePaintTokenKey =
  `${WheelLinePaintRole}${WheelLinePaintTokenSuffix}`;

const WHEEL_LINE_PAINT_CSS_VARS: Readonly<
  Record<WheelLinePaintRole, Readonly<Record<WheelLinePaintTokenSuffix, string>>>
> = deepFreeze({
  majorRing: {
    WidthScale: "--aries-wheel-major-ring-width-scale",
    Pattern: "--aries-wheel-major-ring-pattern",
    DashOn: "--aries-wheel-major-ring-dash-on",
    DashOff: "--aries-wheel-major-ring-dash-off",
    Opacity: "--aries-wheel-major-ring-opacity",
  },
  minorRing: {
    WidthScale: "--aries-wheel-minor-ring-width-scale",
    Pattern: "--aries-wheel-minor-ring-pattern",
    DashOn: "--aries-wheel-minor-ring-dash-on",
    DashOff: "--aries-wheel-minor-ring-dash-off",
    Opacity: "--aries-wheel-minor-ring-opacity",
  },
  outerMaximumRing: {
    WidthScale: "--aries-wheel-outer-maximum-ring-width-scale",
    Pattern: "--aries-wheel-outer-maximum-ring-pattern",
    DashOn: "--aries-wheel-outer-maximum-ring-dash-on",
    DashOff: "--aries-wheel-outer-maximum-ring-dash-off",
    Opacity: "--aries-wheel-outer-maximum-ring-opacity",
  },
  outerHouseRing: {
    WidthScale: "--aries-wheel-outer-house-ring-width-scale",
    Pattern: "--aries-wheel-outer-house-ring-pattern",
    DashOn: "--aries-wheel-outer-house-ring-dash-on",
    DashOff: "--aries-wheel-outer-house-ring-dash-off",
    Opacity: "--aries-wheel-outer-house-ring-opacity",
  },
  outerDegreeRing: {
    WidthScale: "--aries-wheel-outer-degree-ring-width-scale",
    Pattern: "--aries-wheel-outer-degree-ring-pattern",
    DashOn: "--aries-wheel-outer-degree-ring-dash-on",
    DashOff: "--aries-wheel-outer-degree-ring-dash-off",
    Opacity: "--aries-wheel-outer-degree-ring-opacity",
  },
  zodiacOuterRing: {
    WidthScale: "--aries-wheel-zodiac-outer-ring-width-scale",
    Pattern: "--aries-wheel-zodiac-outer-ring-pattern",
    DashOn: "--aries-wheel-zodiac-outer-ring-dash-on",
    DashOff: "--aries-wheel-zodiac-outer-ring-dash-off",
    Opacity: "--aries-wheel-zodiac-outer-ring-opacity",
  },
  innerDegreeRing: {
    WidthScale: "--aries-wheel-inner-degree-ring-width-scale",
    Pattern: "--aries-wheel-inner-degree-ring-pattern",
    DashOn: "--aries-wheel-inner-degree-ring-dash-on",
    DashOff: "--aries-wheel-inner-degree-ring-dash-off",
    Opacity: "--aries-wheel-inner-degree-ring-opacity",
  },
  zodiacInnerRing: {
    WidthScale: "--aries-wheel-zodiac-inner-ring-width-scale",
    Pattern: "--aries-wheel-zodiac-inner-ring-pattern",
    DashOn: "--aries-wheel-zodiac-inner-ring-dash-on",
    DashOff: "--aries-wheel-zodiac-inner-ring-dash-off",
    Opacity: "--aries-wheel-zodiac-inner-ring-opacity",
  },
  termRing: {
    WidthScale: "--aries-wheel-term-ring-width-scale",
    Pattern: "--aries-wheel-term-ring-pattern",
    DashOn: "--aries-wheel-term-ring-dash-on",
    DashOff: "--aries-wheel-term-ring-dash-off",
    Opacity: "--aries-wheel-term-ring-opacity",
  },
  cuspOuterRing: {
    WidthScale: "--aries-wheel-cusp-outer-ring-width-scale",
    Pattern: "--aries-wheel-cusp-outer-ring-pattern",
    DashOn: "--aries-wheel-cusp-outer-ring-dash-on",
    DashOff: "--aries-wheel-cusp-outer-ring-dash-off",
    Opacity: "--aries-wheel-cusp-outer-ring-opacity",
  },
  innerBoundaryRing: {
    WidthScale: "--aries-wheel-inner-boundary-ring-width-scale",
    Pattern: "--aries-wheel-inner-boundary-ring-pattern",
    DashOn: "--aries-wheel-inner-boundary-ring-dash-on",
    DashOff: "--aries-wheel-inner-boundary-ring-dash-off",
    Opacity: "--aries-wheel-inner-boundary-ring-opacity",
  },
  aspectBoundaryRing: {
    WidthScale: "--aries-wheel-aspect-boundary-ring-width-scale",
    Pattern: "--aries-wheel-aspect-boundary-ring-pattern",
    DashOn: "--aries-wheel-aspect-boundary-ring-dash-on",
    DashOff: "--aries-wheel-aspect-boundary-ring-dash-off",
    Opacity: "--aries-wheel-aspect-boundary-ring-opacity",
  },
  houseBoundaryRing: {
    WidthScale: "--aries-wheel-house-boundary-ring-width-scale",
    Pattern: "--aries-wheel-house-boundary-ring-pattern",
    DashOn: "--aries-wheel-house-boundary-ring-dash-on",
    DashOff: "--aries-wheel-house-boundary-ring-dash-off",
    Opacity: "--aries-wheel-house-boundary-ring-opacity",
  },
  baseRing: {
    WidthScale: "--aries-wheel-base-ring-width-scale",
    Pattern: "--aries-wheel-base-ring-pattern",
    DashOn: "--aries-wheel-base-ring-dash-on",
    DashOff: "--aries-wheel-base-ring-dash-off",
    Opacity: "--aries-wheel-base-ring-opacity",
  },
  degreeTick: {
    WidthScale: "--aries-wheel-degree-tick-width-scale",
    Pattern: "--aries-wheel-degree-tick-pattern",
    DashOn: "--aries-wheel-degree-tick-dash-on",
    DashOff: "--aries-wheel-degree-tick-dash-off",
    Opacity: "--aries-wheel-degree-tick-opacity",
  },
  subdivision: {
    WidthScale: "--aries-wheel-subdivision-width-scale",
    Pattern: "--aries-wheel-subdivision-pattern",
    DashOn: "--aries-wheel-subdivision-dash-on",
    DashOff: "--aries-wheel-subdivision-dash-off",
    Opacity: "--aries-wheel-subdivision-opacity",
  },
  zodiacSpoke: {
    WidthScale: "--aries-wheel-zodiac-spoke-width-scale",
    Pattern: "--aries-wheel-zodiac-spoke-pattern",
    DashOn: "--aries-wheel-zodiac-spoke-dash-on",
    DashOff: "--aries-wheel-zodiac-spoke-dash-off",
    Opacity: "--aries-wheel-zodiac-spoke-opacity",
  },
  termBoundary: {
    WidthScale: "--aries-wheel-term-boundary-width-scale",
    Pattern: "--aries-wheel-term-boundary-pattern",
    DashOn: "--aries-wheel-term-boundary-dash-on",
    DashOff: "--aries-wheel-term-boundary-dash-off",
    Opacity: "--aries-wheel-term-boundary-opacity",
  },
  decanBoundary: {
    WidthScale: "--aries-wheel-decan-boundary-width-scale",
    Pattern: "--aries-wheel-decan-boundary-pattern",
    DashOn: "--aries-wheel-decan-boundary-dash-on",
    DashOff: "--aries-wheel-decan-boundary-dash-off",
    Opacity: "--aries-wheel-decan-boundary-opacity",
  },
  houseCusp: {
    WidthScale: "--aries-wheel-house-cusp-width-scale",
    Pattern: "--aries-wheel-house-cusp-pattern",
    DashOn: "--aries-wheel-house-cusp-dash-on",
    DashOff: "--aries-wheel-house-cusp-dash-off",
    Opacity: "--aries-wheel-house-cusp-opacity",
  },
  angle: {
    WidthScale: "--aries-wheel-angle-width-scale",
    Pattern: "--aries-wheel-angle-pattern",
    DashOn: "--aries-wheel-angle-dash-on",
    DashOff: "--aries-wheel-angle-dash-off",
    Opacity: "--aries-wheel-angle-opacity",
  },
  bodyLeader: {
    WidthScale: "--aries-wheel-body-leader-width-scale",
    Pattern: "--aries-wheel-body-leader-pattern",
    DashOn: "--aries-wheel-body-leader-dash-on",
    DashOff: "--aries-wheel-body-leader-dash-off",
    Opacity: "--aries-wheel-body-leader-opacity",
  },
  outerLeader: {
    WidthScale: "--aries-wheel-outer-leader-width-scale",
    Pattern: "--aries-wheel-outer-leader-pattern",
    DashOn: "--aries-wheel-outer-leader-dash-on",
    DashOff: "--aries-wheel-outer-leader-dash-off",
    Opacity: "--aries-wheel-outer-leader-opacity",
  },
  aspect: {
    WidthScale: "--aries-wheel-aspect-width-scale",
    Pattern: "--aries-wheel-aspect-pattern",
    DashOn: "--aries-wheel-aspect-dash-on",
    DashOff: "--aries-wheel-aspect-dash-off",
    Opacity: "--aries-wheel-aspect-opacity",
  },
});

export interface ResolvedWheelLinePaint {
  readonly width: number;
  readonly dash?: number[];
  /** Canvas line color. Circle callers consume the identical value as outline. */
  readonly fill?: string;
  readonly outline?: string;
  readonly opacity: number;
  readonly lineCap?: CanvasLineCap;
  readonly lineJoin?: CanvasLineJoin;
}

export type ResolvedWheelTypographyPaint = Readonly<{
  font: string;
  size: number;
  weight: number;
  style: string;
  tracking: number;
  color: string;
  opacity: number;
}>;

export interface WheelLabelStyle {
  readonly houseClassicOffsetScale: number;
  readonly houseSecondOffsetScale: number;
  readonly outerRadiusOffsetScale: number;
  readonly outerOutsidePadScale: number;
  readonly outerMotionRadiusScale: number;
  readonly outerMotionOffsetScale: number;
  readonly motionGapMin: number;
  readonly motionGapScale: number;
  readonly motionRadialNudgeScale: number;
  readonly motionTangentNudgeScale: number;
  readonly surveil: Readonly<{
    tickLengthMin: number;
    tickLengthScale: number;
    glyphGapMin: number;
    glyphGapScale: number;
    glyphSizeMin: number;
    glyphSizeScale: number;
    labelGapMin: number;
    labelGapScale: number;
    horizontalThreshold: number;
    maxTextLength: number;
    truncatedPrefixLength: number;
  }>;
}

export interface WheelCollisionStyle {
  readonly shiftStepDegrees: number;
  readonly maxShiftAttempts: number;
  readonly bodyPadMin: number;
  readonly bodyPadScale: number;
  readonly positionRowPadScale: number;
  readonly fixedRayPadMin: number;
  readonly fixedRayPadScale: number;
  readonly labelLayerGap: number;
  readonly labelWidthPad: number;
  readonly labelHeightPad: number;
  readonly outerVerticalStep: number;
  readonly wrapUpperDegrees: number;
  readonly wrapLowerDegrees: number;
  readonly halfCircleDegrees: number;
  readonly fixedStarDownwardStart: number;
  readonly fixedStarDownwardEnd: number;
}

export interface WheelHitStyle {
  readonly bodyRadiusMin: number;
  readonly bodyRadiusDivisor: number;
  readonly glyphRadiusMin: number;
  readonly glyphRadiusScale: number;
  readonly bodyPadMin: number;
  readonly bodyPadScale: number;
  readonly angleLabelPadMin: number;
  readonly angleLabelPadScale: number;
  readonly houseRadiusMin: number;
  readonly houseRadiusDivisor: number;
  readonly signPadMin: number;
  readonly signPadScale: number;
  readonly signHalfBandSignScale: number;
  readonly signHalfBandBodyScale: number;
  readonly signHalfBandPadScale: number;
  readonly midbandPadScale: number;
  readonly aspectRadiusMin: number;
  readonly aspectRadiusDivisor: number;
  readonly aspectLineToleranceMin: number;
  readonly aspectLineTolerancePadScale: number;
  readonly outerRadiusMin: number;
  readonly outerRadiusScale: number;
  readonly outerLabelPadMin: number;
  readonly outerLabelPadScale: number;
  readonly priorities: Readonly<{
    planet: number;
    fortune: number;
    outerBody: number;
    angle: number;
    angloAngle: number;
    house: number;
    sign: number;
    midband: number;
    aspectGlyph: number;
    aspectLine: number;
    secondaryRing: number;
  }>;
}

export interface WheelOverlayStyle {
  readonly compactBreakpoint: number;
  readonly infoFontMin: number;
  readonly infoFontScale: number;
  readonly compactInfoFontMin: number;
  readonly compactInfoFontScale: number;
  readonly iconMin: number;
  readonly iconScale: number;
  readonly compactIconMin: number;
  readonly compactIconScale: number;
  readonly labelMin: number;
  readonly labelScale: number;
  readonly compactLabelMin: number;
  readonly compactLabelScale: number;
  readonly fontBoxScale: number;
  readonly rowHeightFactor: number;
  readonly gapAfterDayHourScale: number;
  readonly groupGapScale: number;
  readonly columnGapMin: number;
  readonly columnGapScale: number;
  readonly edgeInsetScale: number;
  readonly compactEdgeInsetMin: number;
  readonly titlebarSafeTop: number;
  readonly infoGap: number;
  readonly cornerLineHeight: number;
  readonly glyphLineHeight: number;
  readonly maxWidthViewportScale: number;
}

export interface WheelRenderStyle {
  readonly schemaVersion: typeof WHEEL_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: WheelStyleRevision;
  readonly palette: WheelRenderPalette;
  readonly elementColors: WheelElementColors;
  readonly geometry: WheelGeometryProfiles;
  readonly ringRadiusOverrides: WheelRingRadiusOverrides;
  /** Sparse direct profile-v2 values; legacy ratios remain fallback defaults. */
  readonly authoringOverrides: WheelAuthoringOverrides;
  /** Runtime projection target for direct stroke and dash dimensions. */
  readonly authoringTargetRadius: number;
  /** Active variant used by class-granular direct line paint. */
  readonly authoringTargetProfile: WheelTypographyProfile;
  readonly typography: WheelTypographyStyle;
  readonly strokes: WheelStrokeStyle;
  readonly linePaint: WheelLinePaintStyle;
  readonly labels: WheelLabelStyle;
  readonly collision: WheelCollisionStyle;
  readonly hit: WheelHitStyle;
  readonly overlays: WheelOverlayStyle;
  readonly outerLabels: {
    readonly edgePadFactor: number;
  };
}

/**
 * Deliberately safe wheel authoring surface. The geometry fields below are
 * canonical normalized inputs consumed by resolveWheelRingSet(); derived ring
 * radii never become independent style authorities. Collision scheduling,
 * hit targets/priorities, and layout identity remain code-owned.
 */
export type WheelRenderTokens = {
  classicDegreeTickLength: number;
  classicSignSectorLength: number;
  classicPlanetSectorLength: number;
  classicTermSectorLength: number;
  classicDecanSectorLength: number;
  classicPlanetLineLength: number;
  classicRetrogradeOffset: number;
  classicArrowLength: number;
  classicHouseSectorLength: number;
  classicOuterZodiac: number;
  classicOuterLine: number;
  classicOuterProjectedLabel: number;
  classicOuterProjectedLine: number;
  classicInnerPosition: number;
  classicInnerAspectAngle: number;
  classicInnerPositionAngle: number;
  classicInnerPositionHouses: number;
  classicInnerBase: number;
  classicInnerHouseName: number;
  compactSinglePositionLane0: number;
  compactSinglePositionLane1: number;
  compactSinglePositionLane2: number;
  compactComparisonPositionLane0: number;
  compactComparisonPositionLane1: number;
  compactComparisonPositionLane2: number;
  compactPositionInset: number;
  compactPositionMinuteInsetSingle: number;
  compactPositionMinuteInsetWithOuter: number;
  compactPositionMinuteInsetComparison: number;
  compactRetrogradeInset: number;
  compactBase: number;
  compactHouseSector: number;
  compactHouseName: number;
  angloZodiacSingle: number;
  angloZodiacWithOuter: number;
  angloZodiacComparisonWithHouses: number;
  angloSubdivisionSector: number;
  angloSignInnerScale: number;
  angloRulerBaseScale: number;
  angloRulerSubdivisionScale: number;
  angloCuspLabelScale: number;
  angloInnerScale: number;
  angloPlanetScale: number;
  angloAspectScale: number;
  angloHouseScale: number;
  angloLeaderInsetScale: number;
  angloAspectLeaderInsetScale: number;
  angloPositionInsetScale: number;
  angloAnglePositionScale: number;
  angloArrowInset: number;
  angloArrowMaximum: number;
  biwheelOuterMax: number;
  biwheelOuterHouseSector: number;
  biwheelZodiacInset: number;
  biwheelOuterPlanetSector: number;
  biwheelOuterAngle: number;
  biwheelArrowLength: number;
  biwheelOuterLineOffset: number;
  biwheelProjectedLabel: number;
  biwheelRetrogradeOffset: number;
  biwheelOuterMinimum: number;
  bodyScale: number;
  classicOuterScale: number;
  compactOuterScale: number;
  angloOuterScale: number;
  classicSignScale: number;
  compactSignScale: number;
  angloSignScale: number;
  classicSubdivisionScale: number;
  compactSubdivisionScale: number;
  angloSubdivisionScale: number;
  termGlyphScale: number;
  decanGlyphScale: number;
  angleLabelScale: number;
  angleLabelWeight: number;
  syzygyScale: number;
  houseLabelScale: number;
  bodyPositionDegreeScale: number;
  bodyPositionSignScale: number;
  bodyPositionMinuteScale: number;
  anglePositionDegreeScale: number;
  anglePositionSignScale: number;
  anglePositionMinuteScale: number;
  housePositionDegreeScale: number;
  housePositionSignScale: number;
  housePositionMinuteScale: number;
  aspectGlyphScale: number;
  aspectGlyphOffsetScale: number;
  motionScale: number;
  outerLabelScale: number;
  outerProjectedGlyphScale: number;
  angloBodyDegreeScale: number;
  /** @deprecated Use bodyPositionSignScale. Retained for sparse profile migration. */
  angloBodySignScale: number;
  angloBodyMinuteScale: number;
  angloAnglePositionDegreeScale: number;
  /** @deprecated Use anglePositionSignScale. Retained for sparse profile migration. */
  angloAnglePositionSignScale: number;
  angloAnglePositionMinuteScale: number;
  angloAnglePositionGapScale: number;
  angloHousePositionDegreeScale: number;
  /** @deprecated Use housePositionSignScale. Retained for sparse profile migration. */
  angloHousePositionSignScale: number;
  angloHousePositionMinuteScale: number;
  angloHousePositionGapScale: number;
  mediumStrokeBase: number;
  hairlineStroke: number;
  angloStructuralStroke: number;
  degreeTickStrokeSmall: number;
  degreeTickStrokeLarge: number;
  ascMcStrokeBase: number;
  chartRingStrokeFallback: number;
  chartRingStrokeMin: number;
  chartRingStrokeMax: number;
  aspectClassicWidth: number;
  aspectAngloWidth: number;
  aspectClassicDashOn: number;
  aspectClassicDashOff: number;
  aspectAngloDashOn: number;
  aspectAngloDashOff: number;
  aspectClassicThicknessMin: number;
  aspectClassicThicknessMax: number;
  aspectClassicThicknessDefault: number;
  aspectAngloThicknessMin: number;
  aspectAngloThicknessMax: number;
  aspectAngloThicknessDefault: number;
  houseClassicOffsetScale: number;
  houseSecondOffsetScale: number;
  outerRadiusOffsetScale: number;
  outerOutsidePadScale: number;
  outerMotionRadiusScale: number;
  outerMotionOffsetScale: number;
  motionGapMin: number;
  motionGapScale: number;
  motionRadialNudgeScale: number;
  motionTangentNudgeScale: number;
  surveilTickLengthMin: number;
  surveilTickLengthScale: number;
  surveilGlyphGapMin: number;
  surveilGlyphGapScale: number;
  surveilGlyphSizeMin: number;
  surveilGlyphSizeScale: number;
  surveilLabelGapMin: number;
  surveilLabelGapScale: number;
  outerLabelEdgePadFactor: number;
  overlayCompactBreakpoint: number;
  overlayInfoFontMin: number;
  overlayInfoFontScale: number;
  overlayCompactInfoFontMin: number;
  overlayCompactInfoFontScale: number;
  overlayIconMin: number;
  overlayIconScale: number;
  overlayCompactIconMin: number;
  overlayCompactIconScale: number;
  overlayLabelMin: number;
  overlayLabelScale: number;
  overlayCompactLabelMin: number;
  overlayCompactLabelScale: number;
  overlayFontBoxScale: number;
  overlayRowHeightFactor: number;
  overlayGapAfterDayHourScale: number;
  overlayGroupGapScale: number;
  overlayColumnGapMin: number;
  overlayColumnGapScale: number;
  overlayEdgeInsetScale: number;
  overlayCompactEdgeInsetMin: number;
  overlayTitlebarSafeTop: number;
  overlayInfoGap: number;
  overlayCornerLineHeight: number;
  overlayGlyphLineHeight: number;
  overlayMaxWidthViewportScale: number;
} & Record<WheelLinePaintTokenKey | WheelRingRadiusTokenKey, number>;

type WheelRenderTokenSpecs = {
  readonly [K in keyof WheelRenderTokens]: readonly [cssVar: string, fallback: number];
};

export type WheelCssValueReader = (cssVar: string) => string | undefined;

/**
 * New renderer callers provide the complete style object. The legacy branch
 * remains explicit so existing website/export adapters cannot accidentally
 * draw without a palette.
 */
export type WheelRenderStyleSource =
  | {
      readonly renderStyle: WheelRenderStyle;
      readonly palette?: never;
      readonly styleRevision?: never;
      readonly fontUi?: never;
      readonly fontSymbols?: never;
    }
  | {
      readonly renderStyle?: undefined;
      readonly palette: ChartPalette;
      readonly styleRevision?: WheelStyleRevision;
      readonly fontUi?: string;
      readonly fontSymbols?: string;
    };

export interface ResolvedWheelTypographyMetrics {
  /** Stable renderer layout unit. This is deliberately not authorable. */
  readonly layoutUnit: number;
  /** Stable profile-specific outer layout unit. This is not a body-size token. */
  readonly outerLayoutUnit: number;
  readonly bodySize: number;
  readonly outerSize: number;
  readonly signSize: number;
  readonly subdivisionSize: number;
  readonly termSize: number;
  readonly decanSize: number;
  readonly angleLabelScale: number;
  readonly angleLabelSize: number;
  readonly outerAngleLabelSize: number;
  readonly angleLabelWeight: number;
  readonly syzygyScale: number;
  readonly houseLabelSize: number;
  readonly outerHouseLabelSize: number;
  readonly bodyPosition: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
  }>;
  readonly anglePosition: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
  }>;
  readonly housePosition: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
  }>;
  readonly angloBodyPosition: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
  }>;
  readonly angloAnglePosition: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
    gap: number;
  }>;
  readonly angloHousePosition: Readonly<{
    degreeSize: number;
    signSize: number;
    minuteSize: number;
    gap: number;
  }>;
  readonly aspectGlyphSize: number;
  readonly interchartAspectGlyphSize: number;
  readonly aspectGlyphOffset: number;
  readonly motionSize: number;
  readonly outerMotionSize: number;
  readonly outerLabelSize: number;
  readonly outerProjectedGlyphSize: number;
  readonly secondaryRing: Readonly<
    Partial<Record<WheelAuthoringTypographyClass, number>>
  >;
}

export interface ResolvedWheelStrokeMetrics {
  readonly medium: number;
  readonly degreeTick: number;
  readonly ascMc: number;
}

export interface ResolvedWheelOverlayMetrics {
  readonly chartSize: number;
  readonly compact: boolean;
  readonly infoFontSize: number;
  readonly iconSize: number;
  readonly labelSize: number;
  readonly lineHeight: number;
  readonly gapAfterDayHour: number;
  readonly gapBetweenGroups: number;
  readonly columnGap: number;
  readonly edgeInset: number;
  readonly topEdgeInset: number;
  readonly maxWidth?: string;
}

/** Shared DOM/scene projection for the four chart-corner overlay clusters. */
export function resolveWheelOverlayMetrics(
  overlays: WheelOverlayStyle,
  viewport: Readonly<{ width: number; height: number }>,
): ResolvedWheelOverlayMetrics {
  const chartSize = Math.min(viewport.width, viewport.height);
  const compact =
    viewport.width > 0 && viewport.width <= overlays.compactBreakpoint;
  const symbolSize = chartSize > 0 ? chartSize / 32 : 0;
  const infoFontSize = Math.max(
    compact ? overlays.compactInfoFontMin : overlays.infoFontMin,
    symbolSize * (
      compact ? overlays.compactInfoFontScale : overlays.infoFontScale
    ),
  );
  const iconSize = Math.max(
    compact ? overlays.compactIconMin : overlays.iconMin,
    ((2 * symbolSize) / 3) * (
      compact ? overlays.compactIconScale : overlays.iconScale
    ),
  );
  const labelSize = Math.max(
    compact ? overlays.compactLabelMin : overlays.labelMin,
    symbolSize * (
      compact ? overlays.compactLabelScale : overlays.labelScale
    ),
  );
  const lineHeight = Math.max(
    1,
    Math.round(
      Math.max(iconSize, labelSize)
      * overlays.fontBoxScale
      * overlays.rowHeightFactor,
    ),
  );
  const edgeInset = chartSize > 0
    ? Math.max(
        compact ? overlays.compactEdgeInsetMin : 0,
        chartSize * overlays.edgeInsetScale,
      )
    : 0;
  return Object.freeze({
    chartSize,
    compact,
    infoFontSize,
    iconSize,
    labelSize,
    lineHeight,
    gapAfterDayHour: Math.round(
      lineHeight * overlays.gapAfterDayHourScale,
    ),
    gapBetweenGroups: Math.round(
      lineHeight * overlays.groupGapScale,
    ),
    columnGap: Math.max(
      overlays.columnGapMin,
      Math.floor(symbolSize * overlays.columnGapScale),
    ),
    edgeInset,
    topEdgeInset: compact
      ? edgeInset
      : edgeInset + overlays.titlebarSafeTop,
    ...(viewport.width > 0 && viewport.width < 640
      ? { maxWidth: `${overlays.maxWidthViewportScale * 100}vw` }
      : {}),
  });
}

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "wheel-render-style-v1";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function cloneStyleValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneStyleValue(entry)) as T;
  }
  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = cloneStyleValue(entry);
    }
    return clone as T;
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(cloneStyleValue(value));
}

const DEFAULT_PALETTE: ChartPalette = {
  background: "rgb(35,36,40)",
  frame: "rgb(220,220,221)",
  signs: "rgb(215,215,217)",
  angles: "rgb(205,205,209)",
  houses: "rgb(138,139,141)",
  houseNums: "rgb(59,59,60)",
  positions: "rgb(255,255,255)",
  peregrin: "rgb(205,205,209)",
  domicil: "rgb(2,191,2)",
  exil: "rgb(255,0,0)",
  exal: "rgb(255,215,0)",
  casus: "rgb(205,92,92)",
  textDim: "rgb(120,121,123)",
  textBright: "rgb(220,220,221)",
  fortune: "rgb(215,215,217)",
  surveilAccent: "rgb(229,146,70)",
  planets: Array.from({ length: 13 }, () => "rgb(205,205,209)"),
  aspects: Array.from({ length: 14 }, () => "rgb(205,205,209)"),
};

function elementColorsFromPalette(palette: ChartPalette): WheelElementColors {
  return deepFreeze({
    outerMaximumRing: palette.frame,
    outerHouseRing: palette.frame,
    outerDegreeRing: palette.frame,
    zodiacOuterRing: palette.frame,
    innerDegreeRing: palette.frame,
    zodiacInnerRing: palette.frame,
    termRing: palette.frame,
    cuspOuterRing: palette.frame,
    innerBoundaryRing: palette.frame,
    aspectBoundaryRing: palette.frame,
    houseBoundaryRing: palette.houses,
    angloHouseBoundaryRing: palette.frame,
    baseRing: palette.angles,
    angloBaseRing: palette.frame,
    zodiacSpoke: palette.frame,
    houseCusp: palette.houses,
    houseLabel: palette.houseNums,
    angloHouseLabel: palette.textDim,
    termBoundary: palette.frame,
    termGlyph: palette.signs,
    decanBoundary: palette.frame,
    decanGlyph: palette.signs,
    bodyLeader: palette.frame,
    angloBodyLeader: palette.angles,
    outerLeader: palette.frame,
    angloOuterLeader: palette.angles,
    angleRay: palette.angles,
    angleLabel: palette.angles,
    surveilAccent: palette.surveilAccent ?? "rgb(229,146,70)",
  });
}

export function resolveWheelElementColors(
  readValue: WheelCssValueReader = () => "",
  palette: ChartPalette = DEFAULT_PALETTE,
): WheelElementColors {
  const fallbacks = elementColorsFromPalette(palette);
  const colors = {} as Record<keyof WheelElementColors, string>;
  for (const key of Object.keys(WHEEL_RENDER_PALETTE_SPECS) as Array<keyof WheelElementColors>) {
    const [cssVar] = WHEEL_RENDER_PALETTE_SPECS[key];
    const candidate = readValue(cssVar)?.trim();
    colors[key] = candidate && !candidate.startsWith("var(")
      ? candidate
      : fallbacks[key];
  }
  return deepFreeze(colors) as WheelElementColors;
}

export const CLASSIC_WHEEL_GEOMETRY_PROFILE: ClassicWheelGeometryProfile = deepFreeze({
  degreeTickLength: 0.01,
  signSectorLength: 0.15,
  planetSectorLength: 0.15,
  termSectorLength: 0.08,
  decanSectorLength: 0.08,
  planetLineLength: 0.03,
  retrogradeOffset: 0.01,
  arrowLength: 0.04,
  houseSectorLength: 0.06,
  outer: {
    zodiac: 0.83,
    line: 0.86,
    projectedLabel: 0.90,
    projectedLine: 0.86,
  },
  inner: {
    position: 0.48,
    aspectAngle: 0.43,
    positionAngle: 0.41,
    positionHouses: 0.32,
    base: 0.11,
    houseName: 0.14,
  },
  singlePositionLanes: [
    { position: 0.48, aspectAngle: 0.43, positionAngle: 0.41, positionHouses: 0.32 },
    { position: 0.40, aspectAngle: 0.36, positionAngle: 0.34, positionHouses: 0.25 },
    { position: 0.32, aspectAngle: 0.28, positionAngle: 0.27, positionHouses: 0.21 },
  ],
  comparisonPositionLanes: [
    { position: 0.45, aspectAngle: 0.41, positionAngle: 0.41, positionHouses: 0.32 },
    { position: 0.37, aspectAngle: 0.32, positionAngle: 0.32, positionHouses: 0.24 },
    { position: 0.30, aspectAngle: 0.25, positionAngle: 0.25, positionHouses: 0.20 },
  ],
});

export const COMPACT_WHEEL_GEOMETRY_PROFILE: CompactWheelGeometryProfile = deepFreeze({
  positionLaneSingle: [0.36, 0.30, 0.24],
  positionLaneComparison: [0.34, 0.26, 0.20],
  positionInset: 0.15,
  positionMinuteInsetSingle: 0.05,
  positionMinuteInsetWithOuter: 0.04,
  positionMinuteInsetComparison: 0.05,
  retrogradeInset: 0.05,
  base: 0.24,
  houseSector: 0.06,
  houseName: 0.27,
  densityOffsetWithPositions: [0, 0.02, 0.08, 0.12],
  densityOffsetWithoutPositions: [0, 0, 0, 0.05],
});

export const ANGLO_WHEEL_GEOMETRY_PROFILE: AngloWheelGeometryProfile = deepFreeze({
  zodiacSingle: 0.895,
  zodiacWithOuter: 0.895,
  zodiacComparisonWithHouses: 0.8,
  subdivisionSector: 0.047,
  signInnerScale: 0.881,
  rulerBaseScale: 0.058,
  rulerSubdivisionScale: 0.014,
  cuspLabelScale: 0.817,
  innerScale: 0.763,
  planetScale: 0.695,
  aspectScale: 0.352,
  houseScale: 0.44,
  leaderInsetScale: 0.026,
  aspectLeaderInsetScale: 0.03,
  retrogradeInsetScale: 0.036,
  positionInsetScale: 0.083,
  anglePositionScale: 0.521,
  houseCuspTickScale: 0.015,
  angleRulerTickScale: 0.02,
  cuspRulerTicks: {
    short: 0.018,
    medium: 0.03,
    long: 0.05,
  },
  degreeTickLength: 0.008,
  noOuterLineOffset: 0.03,
  arrowInset: 0.035,
  arrowMaximum: 0.995,
  outerSingle: {
    degree0: 0.964,
    degree1: 0.956,
    degree5: 0.948,
    degree10: 0.94,
    line: 0.93,
    projectedLabel: 0.95,
    angle: 0.965,
    arrow: 0.985,
  },
  comparisonNoHouses: {
    planet: 0.95,
    angle: 0.965,
    arrow: 0.985,
    retrograde: 0.93,
    minute: 0.94,
  },
  comparisonWithHouses: {
    degree0: 0.925,
    degree1: 0.917,
    degree5: 0.909,
    degree10: 0.901,
    max: 0.99,
    house: 0.94,
    // Venus' golden-section proportion places the number lane between the
    // outer bodies (0.86) and the restrained cusp endpoint (0.94):
    // 0.86 + (0.94 - 0.86) / phi ≈ 0.91.
    houseName: 0.91,
    planet: 0.86,
    line: 0.825,
    projectedLabel: 0.86,
    retrograde: 0.835,
  },
});

export const BIWHEEL_GEOMETRY_PROFILE: BiwheelGeometryProfile = deepFreeze({
  outerMax: 0.97,
  outerHouseSector: 0.06,
  zodiacInset: 0.12,
  outerPlanetSector: 0.15,
  outerAngle: 0.92,
  arrowLength: 0.04,
  outerLineOffset: 0.03,
  projectedLabel: 0.90,
  retrogradeOffset: 0.01,
  outerMinimum: 0.78,
});

export const DEFAULT_WHEEL_GEOMETRY_PROFILES: WheelGeometryProfiles = deepFreeze({
  classic: CLASSIC_WHEEL_GEOMETRY_PROFILE,
  compact: COMPACT_WHEEL_GEOMETRY_PROFILE,
  anglo: ANGLO_WHEEL_GEOMETRY_PROFILE,
  biwheel: BIWHEEL_GEOMETRY_PROFILE,
});

function resolveClassicBaseRings(
  geometry: WheelGeometryProfiles,
  maxRadius: number,
): WheelRingSet {
  const classic = geometry.classic;
  const signOffset = (classic.signSectorLength / 2) * maxRadius;
  const planetOffset = (classic.planetSectorLength / 2) * maxRadius;
  const r30 = maxRadius * classic.outer.zodiac;
  const rOuter0 = r30;
  const rOuter1 = rOuter0 - classic.degreeTickLength * maxRadius;
  const rOuter5 = rOuter1 - classic.degreeTickLength * maxRadius;
  const rOuter10 = rOuter5 - classic.degreeTickLength * maxRadius;
  const rSign = r30 - signOffset;
  const r0 = r30 - classic.signSectorLength * maxRadius;
  const r1 = r0 + classic.degreeTickLength * maxRadius;
  const r5 = r1 + classic.degreeTickLength * maxRadius;
  const r10 = r5 + classic.degreeTickLength * maxRadius;
  const rASCMC = rSign;
  const rArrow = rASCMC + classic.arrowLength * maxRadius;
  const rTerms = r0;
  const rTermsPlanet = r0 - (classic.termSectorLength / 2) * maxRadius;
  const rDecans = rTerms - classic.termSectorLength * maxRadius;
  const rDecansPlanet = rDecans - (classic.decanSectorLength / 2) * maxRadius;
  const rInner = rDecans - classic.decanSectorLength * maxRadius;
  const rLLine = rInner - classic.planetLineLength * maxRadius;
  const rPlanet = rInner - planetOffset;
  const rAsp = rInner - classic.planetSectorLength * maxRadius;
  const rLLine2 = rAsp + classic.planetLineLength * maxRadius;
  const rRetr = rLLine2 + classic.retrogradeOffset * maxRadius;
  const rPos = maxRadius * classic.inner.position;
  const rAspAscMC = maxRadius * classic.inner.aspectAngle;
  const rPosAscMC = maxRadius * classic.inner.positionAngle;
  const rPosHouses = maxRadius * classic.inner.positionHouses;
  const rBase = maxRadius * classic.inner.base;
  const rHouse = rBase + classic.houseSectorLength * maxRadius;
  const rHouseName = maxRadius * classic.inner.houseName;

  return {
    r30,
    rOuter0,
    rOuter1,
    rOuter5,
    rOuter10,
    rOuterLine: maxRadius * classic.outer.line,
    rAntis: maxRadius * classic.outer.projectedLabel,
    rAntisLines: maxRadius * classic.outer.projectedLine,
    rSign,
    r0,
    r1,
    r5,
    r10,
    rASCMC,
    rArrow,
    rTerms,
    rTermsPlanet,
    rDecans,
    rDecansPlanet,
    rInner,
    rLLine,
    rLLine2,
    rRetr,
    rPlanet,
    rAsp,
    rPos,
    rAspAscMC,
    rPosAscMC,
    rPosHouses,
    rBase,
    rHouse,
    rHouseName,
  };
}

function compactDensityOffset(
  geometry: WheelGeometryProfiles,
  input: WheelGeometryInput,
): number {
  const density = Number(input.showDecans) + Number(input.showTerms) + Number(input.hasOuterRing);
  const offsets = input.showPositions
    ? geometry.compact.densityOffsetWithPositions
    : geometry.compact.densityOffsetWithoutPositions;
  return input.maxRadius * offsets[density];
}

function resolveAngloRings(
  geometry: WheelGeometryProfiles,
  input: WheelGeometryInput,
  zodiacRatio: number,
): WheelRingSet {
  const { maxRadius } = input;
  const anglo = geometry.anglo;
  const base = resolveClassicBaseRings(geometry, maxRadius);
  const r30 = maxRadius * zodiacRatio;
  const subdivisionSector = r30 * anglo.subdivisionSector;
  const termSector = input.showTerms ? subdivisionSector : 0;
  const decanSector = input.showDecans ? subdivisionSector : 0;
  const subdivisionInset = (termSector + decanSector) / 2;
  const r0 = r30 * anglo.signInnerScale + subdivisionInset;
  const rTerms = r0;
  const rDecans = rTerms - termSector;
  const rCuspOuter = rDecans - decanSector;
  const subdivisionCount = Number(input.showTerms) + Number(input.showDecans);
  const rulerSector =
    r30 * (anglo.rulerBaseScale - anglo.rulerSubdivisionScale * subdivisionCount);
  const rCuspLabelOuter = rCuspOuter - rulerSector;
  const rCuspLabel = r30 * anglo.cuspLabelScale - subdivisionInset;
  const rInner = r30 * anglo.innerScale - subdivisionInset;
  const rPlanet = r30 * anglo.planetScale - subdivisionInset;
  const rAsp = r30 * anglo.aspectScale - subdivisionInset;
  const rBase = rAsp;
  const rHouse = r30 * anglo.houseScale - subdivisionInset;
  const outer = anglo.outerSingle;

  return {
    ...base,
    r30,
    rOuter0: input.hasOuterRing ? maxRadius * outer.degree0 : r30,
    rOuter1: input.hasOuterRing
      ? maxRadius * outer.degree1
      : r30 - anglo.degreeTickLength * maxRadius,
    rOuter5: input.hasOuterRing
      ? maxRadius * outer.degree5
      : r30 - anglo.degreeTickLength * 2 * maxRadius,
    rOuter10: input.hasOuterRing
      ? maxRadius * outer.degree10
      : r30 - anglo.degreeTickLength * 3 * maxRadius,
    rOuterLine: input.hasOuterRing
      ? maxRadius * outer.line
      : r30 + anglo.noOuterLineOffset * maxRadius,
    rAntis: maxRadius * outer.projectedLabel,
    rAntisLines: input.hasOuterRing
      ? maxRadius * outer.line
      : r30 + anglo.noOuterLineOffset * maxRadius,
    rSign: (r30 + r0) / 2,
    r0,
    r1: r0 + anglo.degreeTickLength * maxRadius,
    r5: r0 + anglo.degreeTickLength * 2 * maxRadius,
    r10: r0 + anglo.degreeTickLength * 3 * maxRadius,
    rASCMC: r30,
    rArrow: Math.min(
      maxRadius * anglo.arrowMaximum,
      r30 + anglo.arrowInset * maxRadius,
    ),
    rTerms,
    rTermsPlanet: rTerms - termSector / 2,
    rDecans,
    rDecansPlanet: rDecans - decanSector / 2,
    rCuspOuter,
    rCuspLabelOuter,
    rCuspLabel,
    rInner,
    rLLine: rInner - anglo.leaderInsetScale * r30,
    rPlanet,
    rAsp,
    rLLine2: rAsp - anglo.aspectLeaderInsetScale * r30,
    rRetr: rPlanet - anglo.retrogradeInsetScale * r30,
    rPos: rPlanet - anglo.positionInsetScale * r30,
    rAspAscMC: rAsp,
    rPosAscMC: r30 * anglo.anglePositionScale,
    rPosHouses: rCuspLabel,
    rBase,
    rHouse,
    rHouseName: (rAsp + rHouse) / 2,
  };
}

/**
 * Resolve every wheel radius from one immutable render style. Paint, layout,
 * collision handling, and hit testing call this same function so a custom
 * geometry profile cannot leave interaction regions on the default wheel.
 */
function resolveCanonicalWheelRingSet(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
): Readonly<WheelRingSet> {
  const { geometry } = style;
  const { maxRadius } = input;
  const classic = geometry.classic;
  const compact = geometry.compact;
  const biwheel = geometry.biwheel;

  if (input.profile === "anglo") {
    if (
      input.mode === "comparison" &&
      (input.comparisonWithOuterHouses || input.restrainedAngloComparison)
    ) {
      const anglo = geometry.anglo;
      const comparison = anglo.comparisonWithHouses;
      const core = resolveAngloRings(
        geometry,
        { ...input, hasOuterRing: true },
        anglo.zodiacComparisonWithHouses,
      );
      const rOuterMax = maxRadius * comparison.max;
      const rOuterHouse = maxRadius * comparison.house;
      return Object.freeze({
        ...core,
        rOuter0: maxRadius * comparison.degree0,
        rOuter1: maxRadius * comparison.degree1,
        rOuter5: maxRadius * comparison.degree5,
        rOuter10: maxRadius * comparison.degree10,
        rOuterMax,
        rOuterHouse,
        rOuterHouseName: maxRadius * comparison.houseName,
        rOuterPlanet: maxRadius * comparison.planet,
        rOuterASCMC: rOuterMax,
        rOuterArrow: rOuterMax,
        rOuterLine: maxRadius * comparison.line,
        rAntis: maxRadius * comparison.projectedLabel,
        rAntisLines: maxRadius * comparison.line,
        rOuterRetr: maxRadius * comparison.retrograde,
        rOuterMin: rOuterHouse,
      });
    }

    const core = resolveAngloRings(
      geometry,
      input.mode === "comparison" ? { ...input, hasOuterRing: true } : input,
      input.mode === "comparison" || input.hasOuterRing
        ? geometry.anglo.zodiacWithOuter
        : geometry.anglo.zodiacSingle,
    );
    if (input.mode === "single") return Object.freeze(core);
    const comparison = geometry.anglo.comparisonNoHouses;
    return Object.freeze({
      ...core,
      rOuterPlanet: maxRadius * comparison.planet,
      rOuterASCMC: maxRadius * comparison.angle,
      rOuterArrow: maxRadius * comparison.arrow,
      rOuterRetr: maxRadius * comparison.retrograde,
      rOuterMin: maxRadius * comparison.minute,
    });
  }

  if (input.mode === "comparison") {
    const termSector = input.showTerms ? classic.termSectorLength : 0;
    const decanSector = input.showDecans ? classic.decanSectorLength : 0;
    const outerHouseSector = input.showHouses
      ? biwheel.outerHouseSector * maxRadius
      : 0;
    const rOuterMax = maxRadius * biwheel.outerMax;
    const r30 = input.showHouses
      ? rOuterMax - outerHouseSector - biwheel.zodiacInset * maxRadius
      : rOuterMax - biwheel.zodiacInset * maxRadius;
    const rOuterHouseName = rOuterMax - outerHouseSector / 2;
    const rOuterHouse = rOuterMax - outerHouseSector;
    const rOuterPlanet = r30 + (biwheel.outerPlanetSector / 2) * maxRadius;
    const rOuterASCMC = maxRadius * biwheel.outerAngle;
    const rOuterArrow = rOuterASCMC + biwheel.arrowLength * maxRadius;
    const rOuterLine = r30 + biwheel.outerLineOffset * maxRadius;
    const rAntis = maxRadius * biwheel.projectedLabel;
    const rOuterRetr = rOuterLine + biwheel.retrogradeOffset * maxRadius;
    const rOuter0 = r30;
    const rOuter1 = rOuter0 - classic.degreeTickLength * maxRadius;
    const rOuter5 = rOuter1 - classic.degreeTickLength * maxRadius;
    const rOuter10 = rOuter5 - classic.degreeTickLength * maxRadius;
    const rSign = r30 - (classic.signSectorLength / 2) * maxRadius;
    const r0 = r30 - classic.signSectorLength * maxRadius;
    const r1 = r0 + classic.degreeTickLength * maxRadius;
    const r5 = r1 + classic.degreeTickLength * maxRadius;
    const r10 = r5 + classic.degreeTickLength * maxRadius;
    const rTerms = r0;
    const rTermsPlanet = r0 - (termSector / 2) * maxRadius;
    const rDecans = rTerms - termSector * maxRadius;
    const rInner = rDecans - decanSector * maxRadius;
    const rDecansPlanet = rInner + (decanSector / 2) * maxRadius;
    const rLLine = rInner - classic.planetLineLength * maxRadius;
    const rPlanet = rInner - (classic.planetSectorLength / 2) * maxRadius;
    const rAsp = rInner - classic.planetSectorLength * maxRadius;
    const rLLine2 = rAsp + classic.planetLineLength * maxRadius;
    const rRetr = rLLine2 + classic.retrogradeOffset * maxRadius;
    const common = {
      r30,
      rOuterMax,
      rOuterHouseName,
      rOuterHouse,
      rOuterPlanet,
      rOuterASCMC,
      rOuterArrow,
      rOuterLine,
      rAntis,
      rAntisLines: rOuterLine,
      rOuterRetr,
      rOuter0,
      rOuter1,
      rOuter5,
      rOuter10,
      rOuterMin: maxRadius * biwheel.outerMinimum,
      rSign,
      r0,
      r1,
      r5,
      r10,
      rASCMC: rSign,
      rArrow: rSign + classic.arrowLength * maxRadius,
      rTerms,
      rTermsPlanet,
      rDecans,
      rDecansPlanet,
      rInner,
      rLLine,
      rLLine2,
      rRetr,
      rPlanet,
      rAsp,
    };

    if (input.profile === "compact") {
      const densityIndex = Number(input.showTerms) + Number(input.showDecans);
      const positionLane = compact.positionLaneComparison[densityIndex];
      const rPosDeg = rInner - compact.positionInset * maxRadius;
      const rPosMin = rPosDeg - compact.positionMinuteInsetComparison * maxRadius;
      const rBase = maxRadius * compact.base - compactDensityOffset(geometry, input);
      return Object.freeze({
        ...common,
        rRetr: rPosMin - compact.retrogradeInset * maxRadius,
        rPos: rPosDeg,
        rPosDeg,
        rPosMin,
        rAspAscMC: maxRadius * positionLane,
        rPosAscMC: maxRadius * positionLane,
        rPosAscMCMin:
          maxRadius * positionLane - maxRadius * compact.positionMinuteInsetComparison,
        rPosHouses: maxRadius * positionLane,
        rPosHousesMin:
          maxRadius * positionLane - maxRadius * compact.positionMinuteInsetComparison,
        rBase,
        rHouse: rBase + compact.houseSector * maxRadius,
        rHouseName:
          maxRadius * compact.houseName - compactDensityOffset(geometry, input),
      });
    }

    const densityIndex = Number(input.showTerms) + Number(input.showDecans);
    const lane = classic.comparisonPositionLanes[densityIndex];
    const rBase = maxRadius * classic.inner.base;
    return Object.freeze({
      ...common,
      rPos: maxRadius * lane.position,
      rAspAscMC: maxRadius * lane.aspectAngle,
      rPosAscMC: maxRadius * lane.positionAngle,
      rPosHouses: maxRadius * lane.positionHouses,
      rBase,
      rHouse: rBase + classic.houseSectorLength * maxRadius,
      rHouseName: maxRadius * classic.inner.houseName,
    });
  }

  const base = resolveClassicBaseRings(geometry, maxRadius);
  const termSector = input.showTerms ? classic.termSectorLength : 0;
  const decanSector = input.showDecans ? classic.decanSectorLength : 0;
  const rTermsPlanet = base.r0 - (termSector / 2) * maxRadius;
  const rDecans = base.rTerms - termSector * maxRadius;
  const rInner = rDecans - decanSector * maxRadius;
  const rDecansPlanet = rInner + (decanSector / 2) * maxRadius;
  const rPlanet = rInner - (classic.planetSectorLength / 2) * maxRadius;

  if (input.profile === "compact") {
    const densityIndex = Number(input.showTerms) + Number(input.showDecans);
    const positionLane = compact.positionLaneSingle[densityIndex];
    const rPosDeg = rInner - compact.positionInset * maxRadius;
    const positionMinuteInset = input.hasOuterRing
      ? compact.positionMinuteInsetWithOuter
      : compact.positionMinuteInsetSingle;
    const rPosMin = rPosDeg - positionMinuteInset * maxRadius;
    const densityOffset = compactDensityOffset(geometry, input);
    const rBase = maxRadius * compact.base - densityOffset;
    return Object.freeze({
      ...base,
      rTermsPlanet,
      rDecans,
      rDecansPlanet,
      rInner,
      rLLine: rInner - classic.planetLineLength * maxRadius,
      rPlanet,
      rAsp: rInner - compact.positionInset * maxRadius,
      rLLine2:
        rInner - compact.positionInset * maxRadius + classic.planetLineLength * maxRadius,
      rRetr: rPosMin - compact.retrogradeInset * maxRadius,
      rPos: rPosDeg,
      rPosDeg,
      rPosMin,
      rAspAscMC: maxRadius * positionLane,
      rPosAscMC: maxRadius * positionLane,
      rPosAscMCMin: maxRadius * positionLane - maxRadius * compact.positionMinuteInsetComparison,
      rPosHouses: maxRadius * positionLane,
      rPosHousesMin: maxRadius * positionLane - maxRadius * compact.positionMinuteInsetComparison,
      rBase,
      rHouse: rBase + compact.houseSector * maxRadius,
      rHouseName: maxRadius * compact.houseName - densityOffset,
    });
  }

  const densityIndex = Number(input.showTerms) + Number(input.showDecans);
  const lane = classic.singlePositionLanes[densityIndex];
  return Object.freeze({
    ...base,
    rTermsPlanet,
    rDecans,
    rDecansPlanet,
    rInner,
    rLLine: rInner - classic.planetLineLength * maxRadius,
    rPlanet,
    rAsp: rInner - classic.planetSectorLength * maxRadius,
    rLLine2:
      rInner - classic.planetSectorLength * maxRadius + classic.planetLineLength * maxRadius,
    rRetr:
      rInner -
      classic.planetSectorLength * maxRadius +
      (classic.planetLineLength + classic.retrogradeOffset) * maxRadius,
    rPos: maxRadius * lane.position,
    rAspAscMC: maxRadius * lane.aspectAngle,
    rPosAscMC: maxRadius * lane.positionAngle,
    rPosHouses: maxRadius * lane.positionHouses,
  });
}

type MutableWheelRingSet = {
  -readonly [K in keyof WheelRingSet]: WheelRingSet[K];
};

const PAINTED_RING_FIELD: Readonly<
  Record<WheelPaintedRingRole, keyof WheelRingSet>
> = Object.freeze({
  outerMaximumRing: "rOuterMax",
  outerHouseRing: "rOuterHouse",
  outerDegreeRing: "rOuter10",
  zodiacOuterRing: "r30",
  innerDegreeRing: "r10",
  zodiacInnerRing: "r0",
  termRing: "rDecans",
  cuspOuterRing: "rCuspOuter",
  innerBoundaryRing: "rInner",
  aspectBoundaryRing: "rAsp",
  houseBoundaryRing: "rHouse",
  baseRing: "rBase",
});

function activePaintedRingRoles(
  input: WheelGeometryInput,
): readonly WheelPaintedRingRole[] {
  const roles: WheelPaintedRingRole[] = [];
  if (input.comparisonWithOuterHouses) {
    roles.push("outerMaximumRing", "outerHouseRing");
    if (input.profile === "anglo") roles.push("outerDegreeRing");
  }
  roles.push("zodiacOuterRing");
  if (input.profile !== "anglo" && input.hasOuterRing) {
    roles.push("outerDegreeRing");
  }
  if (input.profile !== "anglo") roles.push("innerDegreeRing");
  if (input.showTerms || input.showDecans) roles.push("zodiacInnerRing");
  if (input.showTerms) roles.push("termRing");
  if (input.profile === "anglo") roles.push("cuspOuterRing");
  roles.push("innerBoundaryRing");
  if (input.profile === "classic") roles.push("aspectBoundaryRing");
  if (input.showHouses) roles.push("houseBoundaryRing");
  roles.push("baseRing");
  return roles;
}

function safeAuthoringReferenceRadius(style: WheelRenderStyle): number {
  const referenceRadius = style.authoringOverrides.referenceRadius;
  return Number.isFinite(referenceRadius) && referenceRadius > 0
    ? referenceRadius
    : 400;
}

/** Project one direct profile-v2 chart-pixel value without integer rounding. */
export function resolveWheelAuthoringPx(
  style: WheelRenderStyle,
  authoringPx: number,
  targetWheelRadius = style.authoringTargetRadius,
): number {
  if (!Number.isFinite(authoringPx)) return 0;
  const target = Number.isFinite(targetWheelRadius) && targetWheelRadius >= 0
    ? targetWheelRadius
    : safeAuthoringReferenceRadius(style);
  return authoringPx * target / safeAuthoringReferenceRadius(style);
}

const DEFAULT_WHEEL_FILL_PAINT: ResolvedWheelFillPaint = deepFreeze({
  fillPattern: "none",
  cellSizePx: 4,
  dotSizePx: 1,
  backgroundColor: "transparent",
  backgroundEnabled: false,
  patternColor: "currentColor",
  gradientType: "none",
  gradientDirection: "fixed",
  gradientStartColor: "transparent",
  gradientEndColor: "transparent",
  gradientAngle: 0,
  textureMask: "none",
  maskDirection: "fixed",
  maskAngle: 0,
  maskAmount: 28,
  shadowPattern: "none",
  shadowColor: "transparent",
  shadowXpx: 6,
  shadowYpx: 6,
  shadowBlurPx: 0,
  opacity: 0.2,
  density: 50,
  angle: 45,
  seed: 0,
});

/** Resolve one retained fill class into safe runtime chart pixels. */
export function resolveWheelFillPaint(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringFillClass,
  targetWheelRadius = style.authoringTargetRadius,
): ResolvedWheelFillPaint {
  const source = style.authoringOverrides.fillPaint[profile]?.[classId];
  const sourceCell = source?.cellSizePx ?? DEFAULT_WHEEL_FILL_PAINT.cellSizePx;
  const sourceDot = source?.dotSizePx ?? DEFAULT_WHEEL_FILL_PAINT.dotSizePx;
  const sourceShadowX = source?.shadowXpx ?? DEFAULT_WHEEL_FILL_PAINT.shadowXpx;
  const sourceShadowY = source?.shadowYpx ?? DEFAULT_WHEEL_FILL_PAINT.shadowYpx;
  const sourceShadowBlur =
    source?.shadowBlurPx ?? DEFAULT_WHEEL_FILL_PAINT.shadowBlurPx;
  const cellSizePx = Math.max(
    0.5,
    resolveWheelAuthoringPx(style, Math.min(48, Math.max(0.5, sourceCell)), targetWheelRadius),
  );
  const dotSizePx = Math.min(
    cellSizePx,
    Math.max(
      0.25,
      resolveWheelAuthoringPx(style, Math.min(24, Math.max(0.25, sourceDot)), targetWheelRadius),
    ),
  );
  return deepFreeze({
    fillPattern: (
      source?.fillPattern === "solid"
      || source?.fillPattern === "stipple"
      || source?.fillPattern === "bayer2"
      || source?.fillPattern === "bayer4"
      || source?.fillPattern === "bayer8"
      || source?.fillPattern === "noise"
      || source?.fillPattern === "blueNoise"
      || source?.fillPattern === "paper"
      || source?.fillPattern === "newsprint"
      || source?.fillPattern === "hatch"
      || source?.fillPattern === "crosshatch"
      || source?.fillPattern === "scanline"
      || source?.fillPattern === "atkinson"
      || source?.fillPattern === "floydSteinberg"
    ) ? source.fillPattern : "none",
    cellSizePx,
    dotSizePx,
    backgroundColor: source?.backgroundColor ?? style.palette.background,
    backgroundEnabled: source?.backgroundColor != null,
    patternColor: source?.patternColor ?? style.palette.frame,
    gradientType: (
      source?.gradientType === "linear" || source?.gradientType === "radial"
    ) ? source.gradientType : "none",
    gradientDirection: source?.gradientDirection === "sun" ? "sun" : "fixed",
    gradientStartColor: source?.gradientStartColor ?? style.palette.background,
    gradientEndColor: source?.gradientEndColor ?? style.palette.frame,
    gradientAngle: Math.min(
      180,
      Math.max(-180, source?.gradientAngle ?? DEFAULT_WHEEL_FILL_PAINT.gradientAngle),
    ),
    textureMask: source?.textureMask === "crescent" ? "crescent" : "none",
    maskDirection: source?.maskDirection === "sun" ? "sun" : "fixed",
    maskAngle: Math.min(
      180,
      Math.max(-180, source?.maskAngle ?? DEFAULT_WHEEL_FILL_PAINT.maskAngle),
    ),
    maskAmount: Math.min(
      100,
      Math.max(0, source?.maskAmount ?? DEFAULT_WHEEL_FILL_PAINT.maskAmount),
    ),
    shadowPattern: (
      source?.shadowPattern === "solid"
      || source?.shadowPattern === "stipple"
      || source?.shadowPattern === "bayer2"
      || source?.shadowPattern === "bayer4"
      || source?.shadowPattern === "bayer8"
      || source?.shadowPattern === "noise"
      || source?.shadowPattern === "blueNoise"
      || source?.shadowPattern === "paper"
      || source?.shadowPattern === "newsprint"
      || source?.shadowPattern === "hatch"
      || source?.shadowPattern === "crosshatch"
      || source?.shadowPattern === "scanline"
      || source?.shadowPattern === "atkinson"
      || source?.shadowPattern === "floydSteinberg"
    ) ? source.shadowPattern : "none",
    shadowColor: source?.shadowColor ?? DEFAULT_WHEEL_FILL_PAINT.shadowColor,
    shadowXpx: resolveWheelAuthoringPx(
      style,
      Math.min(128, Math.max(-128, sourceShadowX)),
      targetWheelRadius,
    ),
    shadowYpx: resolveWheelAuthoringPx(
      style,
      Math.min(128, Math.max(-128, sourceShadowY)),
      targetWheelRadius,
    ),
    shadowBlurPx: resolveWheelAuthoringPx(
      style,
      Math.min(64, Math.max(0, sourceShadowBlur)),
      targetWheelRadius,
    ),
    opacity: Math.min(1, Math.max(0, source?.opacity ?? DEFAULT_WHEEL_FILL_PAINT.opacity)),
    density: Math.min(100, Math.max(0, source?.density ?? DEFAULT_WHEEL_FILL_PAINT.density)),
    angle: Math.min(180, Math.max(-180, source?.angle ?? DEFAULT_WHEEL_FILL_PAINT.angle)),
    seed: Math.min(
      65535,
      Math.max(0, Math.round(source?.seed ?? DEFAULT_WHEEL_FILL_PAINT.seed)),
    ),
  });
}

/** Whether a retained fill needs one settled repaint when the Sun moves. */
export function wheelFillUsesSolarDirection(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
): boolean {
  for (const classId of WHEEL_AUTHORING_FILL_CLASSES) {
    const source = style.authoringOverrides.fillPaint[profile]?.[classId];
    if (
      source?.gradientType !== "none"
      && source?.gradientType != null
      && source.gradientDirection === "sun"
    ) {
      return true;
    }
    if (
      classId !== "canvas.background"
      && source?.textureMask === "crescent"
      && source.maskDirection === "sun"
    ) {
      return true;
    }
  }
  return false;
}

function applyPaintedRingRadiusOverrides(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
  canonical: Readonly<WheelRingSet>,
): Readonly<WheelRingSet> {
  const rings = { ...canonical } as MutableWheelRingSet;
  const roles = activePaintedRingRoles(input);
  const legacyOverrides = style.ringRadiusOverrides[input.profile];
  const directOverrides = style.authoringOverrides.ringRadii[input.profile];
  const gap = Math.max(1, input.maxRadius * 0.005);

  // Direct profile-v2 values are reference-space px and use presence rather
  // than a sentinel, so zero remains a real input. Legacy normalized values
  // retain zero-as-auto strictly as a migration/default path. Each explicit
  // radius is neighbour-clamped so malformed source cannot invert the stack.
  for (let index = 0; index < roles.length; index += 1) {
    const role = roles[index];
    const directOverride = directOverrides?.[role];
    const legacyOverride = legacyOverrides[role];
    const overrideRadius = directOverride !== undefined && Number.isFinite(directOverride)
      ? resolveWheelAuthoringPx(style, directOverride, input.maxRadius)
      : legacyOverride > 0
        ? legacyOverride * input.maxRadius
        : undefined;
    if (overrideRadius === undefined) continue;
    const field = PAINTED_RING_FIELD[role];
    if (rings[field] == null) continue;
    const outerField = index > 0 ? PAINTED_RING_FIELD[roles[index - 1]] : null;
    const innerField = index + 1 < roles.length
      ? PAINTED_RING_FIELD[roles[index + 1]]
      : null;
    const outerRadius = outerField ? rings[outerField] : undefined;
    const innerRadius = innerField ? rings[innerField] : undefined;
    const maximum = typeof outerRadius === "number"
      ? outerRadius - gap
      : input.maxRadius - gap;
    const minimum = typeof innerRadius === "number"
      ? innerRadius + gap
      : gap;
    const safeMaximum = Math.max(gap, maximum);
    const safeMinimum = Math.min(safeMaximum, Math.max(gap, minimum));
    rings[field] = Math.min(safeMaximum, Math.max(safeMinimum, overrideRadius));
  }

  // Keep the degree ruler ticks attached to their exact authored terminal
  // circles without turning the intermediate tick radii into extra tokens.
  if (input.profile !== "anglo") rings.rOuter0 = rings.r30;
  const innerThird = (rings.r10 - rings.r0) / 3;
  rings.r1 = rings.r0 + innerThird;
  rings.r5 = rings.r0 + innerThird * 2;
  const outerThird = (rings.rOuter10 - rings.rOuter0) / 3;
  rings.rOuter1 = rings.rOuter0 + outerThird;
  rings.rOuter5 = rings.rOuter0 + outerThird * 2;
  rings.rTerms = rings.r0;

  return Object.freeze(rings);
}

/** Resolve canonical layout first, then apply safe exact painted-ring radii. */
export function resolveWheelRingSet(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
): Readonly<WheelRingSet> {
  return applyPaintedRingRadiusOverrides(
    style,
    input,
    resolveCanonicalWheelRingSet(style, input),
  );
}

/** Exact painted-circle radius used by paint, hit testing, and the inspector. */
export function resolveWheelPaintedRingRadius(
  style: WheelRenderStyle,
  input: WheelGeometryInput,
  role: WheelPaintedRingRole,
): number {
  const field = PAINTED_RING_FIELD[role];
  const radius = resolveWheelRingSet(style, input)[field];
  return typeof radius === "number" ? radius : 0;
}

const PROFILE_BODY = 1 / 16;
const PROFILE_OUTER = deepFreeze({
  classic: 1 / 16,
  compact: 1 / 16,
  anglo: 1 / 20,
});
const PROFILE_SIGN = deepFreeze({
  classic: 1 / 20,
  compact: 1 / 20,
  anglo: 1 / 25,
});
const PROFILE_MOTION_SCALE = deepFreeze({
  classic: 1,
  compact: 1,
  anglo: 1.2,
});
const PROFILE_SUBDIVISION = deepFreeze({
  classic: 1 / 24,
  compact: 1 / 24,
  anglo: 1 / 32,
});

const DEFAULT_RATIOS: WheelTypographyRatios = deepFreeze({
  body: PROFILE_BODY,
  outer: PROFILE_OUTER,
  sign: PROFILE_SIGN,
  subdivision: PROFILE_SUBDIVISION,
  termGlyphScale: 1,
  decanGlyphScale: 1,
  angleLabelScale: 0.75,
  angleLabelWeight: 500,
  syzygyScale: 0.58,
  houseLabelScale: 0.5,
  bodyPosition: {
    degreeScale: 0.5,
    signScale: 0.56,
    minuteScale: 0.25,
  },
  anglePosition: {
    degreeScale: 0.5,
    signScale: 0.52,
    minuteScale: 0.25,
  },
  housePosition: {
    degreeScale: 0.5,
    signScale: 0.52,
    minuteScale: 0.25,
  },
  aspectGlyphScale: 0.5,
  aspectGlyphOffsetScale: 0.25,
  motionScale: 0.25,
  outerLabelScale: 0.5,
  outerProjectedGlyphScale: 1,
  angloBodyPosition: {
    degreeRadiusOffset: 1,
    degreeScale: 0.46,
    signRadiusOffset: 1.65,
    signScale: 0.56,
    minuteRadiusOffset: 2.32,
    minuteScale: 0.36,
  },
  angloAnglePosition: {
    degreeScale: 0.4,
    signScale: 0.52,
    minuteScale: 0.34,
    gapScale: 0.08,
  },
  angloHousePosition: {
    degreeScale: 0.4,
    signScale: 0.52,
    minuteScale: 0.34,
    gapScale: 0.08,
  },
  fallbackMeasureWidthScale: 0.58,
});

const DEFAULT_TYPOGRAPHY: WheelTypographyStyle = deepFreeze({
  families: {
    ui: DEFAULT_UI_FONT,
    symbols: DEFAULT_SYMBOL_FONT,
    bodySymbols: DEFAULT_SYMBOL_FONT,
    signSymbols: DEFAULT_SYMBOL_FONT,
    termSymbols: DEFAULT_SYMBOL_FONT,
    decanSymbols: DEFAULT_SYMBOL_FONT,
    aspectSymbols: DEFAULT_SYMBOL_FONT,
  },
  ratios: DEFAULT_RATIOS,
});

const DEFAULT_STROKES: WheelStrokeStyle = deepFreeze({
  referenceSize: 720,
  mediumBase: 2,
  hairline: 1,
  angloStructural: 2,
  degreeTick: { breakpoint: 600, small: 1, large: 2 },
  ascMcDefaultBase: 5,
  chartRing: { fallbackBase: 3, minBase: 1, maxBase: 3 },
  arrows: {
    halfAngleDegrees: 0.5,
    lineCap: "round",
    lineJoin: "round",
    angloBaseInsetScale: 0.022,
    angloHalfAngleDegrees: 0.9,
  },
  aspects: {
    classicWidth: 1,
    angloWidth: 0.85,
    classicDash: [10, 10],
    angloDash: [5, 5],
    classicThicknessMax: 4,
    classicThicknessMin: 1,
    classicThicknessNoOrb: 2,
    angloThicknessMin: 0.75,
    angloThicknessSpan: 1.25,
    angloThicknessNoOrb: 1.25,
    classicOpacityMin: 0.3,
    classicOpacitySpan: 0.7,
    angloOpacityMin: 0.45,
    angloOpacitySpan: 0.55,
  },
});

const DEFAULT_LINE_PAINT_ROLE: WheelLinePaintRoleStyle = deepFreeze({
  widthScale: 1,
  pattern: 0,
  dashOn: 6,
  dashOff: 4,
  opacity: 1,
});

export const DEFAULT_WHEEL_LINE_PAINT: WheelLinePaintStyle = deepFreeze(
  Object.fromEntries(
    WHEEL_LINE_PAINT_ROLES.map((role) => [role, { ...DEFAULT_LINE_PAINT_ROLE }]),
  ) as Record<WheelLinePaintRole, WheelLinePaintRoleStyle>,
);

const EMPTY_WHEEL_RING_RADIUS_OVERRIDES: WheelRingRadiusOverrides = deepFreeze(
  Object.fromEntries(
    (["classic", "compact", "anglo"] as const).map((profile) => [
      profile,
      Object.fromEntries(WHEEL_PAINTED_RING_ROLES.map((role) => [role, 0])),
    ]),
  ) as Record<
    WheelTypographyProfile,
    Record<WheelPaintedRingRole, number>
  >,
);

export const DEFAULT_WHEEL_AUTHORING_OVERRIDES: WheelAuthoringOverrides = deepFreeze({
  referenceRadius: 400,
  typography: {},
  linePaint: {},
  fillPaint: {},
  ringRadii: {},
});

const DEFAULT_LABELS: WheelLabelStyle = deepFreeze({
  houseClassicOffsetScale: 0.25,
  houseSecondOffsetScale: 0.125,
  outerRadiusOffsetScale: 0.2,
  outerOutsidePadScale: 0.1,
  outerMotionRadiusScale: 0.16,
  outerMotionOffsetScale: 0.125,
  motionGapMin: 1,
  motionGapScale: 0.04,
  motionRadialNudgeScale: 1,
  motionTangentNudgeScale: 2,
  surveil: {
    tickLengthMin: 5,
    tickLengthScale: 0.42,
    glyphGapMin: 2,
    glyphGapScale: 0.12,
    glyphSizeMin: 5,
    glyphSizeScale: 0.34,
    labelGapMin: 2,
    labelGapScale: 0.08,
    horizontalThreshold: 0.25,
    maxTextLength: 18,
    truncatedPrefixLength: 17,
  },
});

const DEFAULT_COLLISION: WheelCollisionStyle = deepFreeze({
  shiftStepDegrees: 0.1,
  maxShiftAttempts: 3600,
  bodyPadMin: 1,
  bodyPadScale: 0.06,
  positionRowPadScale: 0.6,
  fixedRayPadMin: 1,
  fixedRayPadScale: 0.08,
  labelLayerGap: 1,
  labelWidthPad: 2,
  labelHeightPad: 1,
  outerVerticalStep: 1,
  wrapUpperDegrees: 300,
  wrapLowerDegrees: 60,
  halfCircleDegrees: 180,
  fixedStarDownwardStart: 65,
  fixedStarDownwardEnd: 245,
});

const DEFAULT_HIT: WheelHitStyle = deepFreeze({
  bodyRadiusMin: 10,
  bodyRadiusDivisor: 14,
  glyphRadiusMin: 1,
  glyphRadiusScale: 0.5,
  bodyPadMin: 1,
  bodyPadScale: 0.06,
  angleLabelPadMin: 2,
  angleLabelPadScale: 0.06,
  houseRadiusMin: 8,
  houseRadiusDivisor: 18,
  signPadMin: 6,
  signPadScale: 0.35,
  signHalfBandSignScale: 0.7,
  signHalfBandBodyScale: 0.6,
  signHalfBandPadScale: 1.5,
  midbandPadScale: 0.5,
  aspectRadiusMin: 8,
  aspectRadiusDivisor: 22,
  aspectLineToleranceMin: 4,
  aspectLineTolerancePadScale: 0.8,
  outerRadiusMin: 10,
  outerRadiusScale: 1,
  outerLabelPadMin: 4,
  outerLabelPadScale: 0.35,
  priorities: {
    planet: 40,
    fortune: 34,
    outerBody: 38,
    angle: 30,
    angloAngle: 40,
    house: 22,
    sign: 10,
    midband: -10,
    aspectGlyph: 32,
    aspectLine: 18,
    secondaryRing: 46,
  },
});

const DEFAULT_OUTER_LABELS = deepFreeze({ edgePadFactor: 0.15 });

const DEFAULT_OVERLAYS: WheelOverlayStyle = deepFreeze({
  compactBreakpoint: 390,
  infoFontMin: 10,
  infoFontScale: 0.75,
  compactInfoFontMin: 11,
  compactInfoFontScale: 0.86,
  iconMin: 10,
  iconScale: 0.83,
  compactIconMin: 12,
  compactIconScale: 1.02,
  labelMin: 8,
  labelScale: 0.4104,
  compactLabelMin: 9.5,
  compactLabelScale: 0.52,
  fontBoxScale: 1.2,
  rowHeightFactor: 0.94,
  gapAfterDayHourScale: 0.3,
  groupGapScale: 0.3,
  columnGapMin: 2,
  columnGapScale: 0.19,
  edgeInsetScale: 0.04,
  compactEdgeInsetMin: 10,
  titlebarSafeTop: 14,
  infoGap: 0,
  cornerLineHeight: 1.1,
  glyphLineHeight: 1,
  maxWidthViewportScale: 0.42,
});

function immutablePalette(palette: ChartPalette): WheelRenderPalette {
  return deepFreeze({
    ...palette,
    planets: [...palette.planets],
    aspects: [...palette.aspects],
  });
}

export const DEFAULT_WHEEL_RENDER_STYLE: WheelRenderStyle = deepFreeze({
  schemaVersion: WHEEL_RENDER_STYLE_SCHEMA_VERSION,
  revision: DEFAULT_REVISION,
  palette: immutablePalette(DEFAULT_PALETTE),
  elementColors: elementColorsFromPalette(DEFAULT_PALETTE),
  geometry: DEFAULT_WHEEL_GEOMETRY_PROFILES,
  ringRadiusOverrides: EMPTY_WHEEL_RING_RADIUS_OVERRIDES,
  authoringOverrides: DEFAULT_WHEEL_AUTHORING_OVERRIDES,
  authoringTargetRadius: DEFAULT_WHEEL_AUTHORING_OVERRIDES.referenceRadius,
  authoringTargetProfile: "classic",
  typography: DEFAULT_TYPOGRAPHY,
  strokes: DEFAULT_STROKES,
  linePaint: DEFAULT_WHEEL_LINE_PAINT,
  labels: DEFAULT_LABELS,
  collision: DEFAULT_COLLISION,
  hit: DEFAULT_HIT,
  overlays: DEFAULT_OVERLAYS,
  outerLabels: DEFAULT_OUTER_LABELS,
});

function wheelLinePaintTokenKey(
  role: WheelLinePaintRole,
  suffix: WheelLinePaintTokenSuffix,
): WheelLinePaintTokenKey {
  return `${role}${suffix}` as WheelLinePaintTokenKey;
}

export function wheelRingRadiusTokenKey(
  profile: WheelTypographyProfile,
  role: WheelPaintedRingRole,
): WheelRingRadiusTokenKey {
  return `${profile}${role[0].toUpperCase()}${role.slice(1)}Radius` as WheelRingRadiusTokenKey;
}

function wheelRingRadiusTokenSpecs(): Readonly<
  Record<WheelRingRadiusTokenKey, readonly [cssVar: string, fallback: number]>
> {
  const specs = {} as Record<
    WheelRingRadiusTokenKey,
    readonly [cssVar: string, fallback: number]
  >;
  for (const profile of ["classic", "compact", "anglo"] as const) {
    for (const role of WHEEL_PAINTED_RING_ROLES) {
      specs[wheelRingRadiusTokenKey(profile, role)] = [
        WHEEL_RING_RADIUS_CSS_VARS[profile][role],
        0,
      ];
    }
  }
  return specs;
}

function wheelLinePaintTokenSpecs(): Readonly<
  Record<WheelLinePaintTokenKey, readonly [cssVar: string, fallback: number]>
> {
  const specs = {} as Record<
    WheelLinePaintTokenKey,
    readonly [cssVar: string, fallback: number]
  >;
  for (const role of WHEEL_LINE_PAINT_ROLES) {
    const cssVars = WHEEL_LINE_PAINT_CSS_VARS[role];
    const defaults = DEFAULT_WHEEL_LINE_PAINT[role];
    specs[wheelLinePaintTokenKey(role, "WidthScale")] = [
      cssVars.WidthScale,
      defaults.widthScale,
    ];
    specs[wheelLinePaintTokenKey(role, "Pattern")] = [
      cssVars.Pattern,
      defaults.pattern,
    ];
    specs[wheelLinePaintTokenKey(role, "DashOn")] = [
      cssVars.DashOn,
      defaults.dashOn,
    ];
    specs[wheelLinePaintTokenKey(role, "DashOff")] = [
      cssVars.DashOff,
      defaults.dashOff,
    ];
    specs[wheelLinePaintTokenKey(role, "Opacity")] = [
      cssVars.Opacity,
      defaults.opacity,
    ];
  }
  return specs;
}

export const WHEEL_RENDER_FONT_SPECS = deepFreeze({
  text: ["--aries-wheel-font-text", "var(--aries-font-ui)"] as const,
  symbols: ["--aries-wheel-font-symbols", "var(--aries-font-symbols)"] as const,
  bodySymbols: ["--aries-wheel-font-body-symbols", "var(--aries-wheel-font-symbols)"] as const,
  signSymbols: ["--aries-wheel-font-sign-symbols", "var(--aries-wheel-font-symbols)"] as const,
  termSymbols: ["--aries-wheel-font-term-symbols", "var(--aries-wheel-font-symbols)"] as const,
  decanSymbols: ["--aries-wheel-font-decan-symbols", "var(--aries-wheel-font-symbols)"] as const,
  aspectSymbols: ["--aries-wheel-font-aspect-symbols", "var(--aries-wheel-font-symbols)"] as const,
});

export const WHEEL_RENDER_TOKEN_SPECS: Readonly<WheelRenderTokenSpecs> = deepFreeze({
  classicDegreeTickLength: [
    "--aries-wheel-classic-degree-tick-length",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.degreeTickLength,
  ],
  classicSignSectorLength: [
    "--aries-wheel-classic-sign-sector-length",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.signSectorLength,
  ],
  classicPlanetSectorLength: [
    "--aries-wheel-classic-planet-sector-length",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.planetSectorLength,
  ],
  classicTermSectorLength: [
    "--aries-wheel-classic-term-sector-length",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.termSectorLength,
  ],
  classicDecanSectorLength: [
    "--aries-wheel-classic-decan-sector-length",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.decanSectorLength,
  ],
  classicPlanetLineLength: [
    "--aries-wheel-classic-planet-line-length",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.planetLineLength,
  ],
  classicRetrogradeOffset: [
    "--aries-wheel-classic-retrograde-offset",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.retrogradeOffset,
  ],
  classicArrowLength: [
    "--aries-wheel-classic-arrow-length",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.arrowLength,
  ],
  classicHouseSectorLength: [
    "--aries-wheel-classic-house-sector-length",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.houseSectorLength,
  ],
  classicOuterZodiac: [
    "--aries-wheel-classic-outer-zodiac",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.outer.zodiac,
  ],
  classicOuterLine: [
    "--aries-wheel-classic-outer-line",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.outer.line,
  ],
  classicOuterProjectedLabel: [
    "--aries-wheel-classic-outer-projected-label",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.outer.projectedLabel,
  ],
  classicOuterProjectedLine: [
    "--aries-wheel-classic-outer-projected-line",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.outer.projectedLine,
  ],
  classicInnerPosition: [
    "--aries-wheel-classic-inner-position",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.inner.position,
  ],
  classicInnerAspectAngle: [
    "--aries-wheel-classic-inner-aspect-angle",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.inner.aspectAngle,
  ],
  classicInnerPositionAngle: [
    "--aries-wheel-classic-inner-position-angle",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.inner.positionAngle,
  ],
  classicInnerPositionHouses: [
    "--aries-wheel-classic-inner-position-houses",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.inner.positionHouses,
  ],
  classicInnerBase: [
    "--aries-wheel-classic-inner-base",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.inner.base,
  ],
  classicInnerHouseName: [
    "--aries-wheel-classic-inner-house-name",
    CLASSIC_WHEEL_GEOMETRY_PROFILE.inner.houseName,
  ],
  compactSinglePositionLane0: [
    "--aries-wheel-compact-single-position-lane-0",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionLaneSingle[0],
  ],
  compactSinglePositionLane1: [
    "--aries-wheel-compact-single-position-lane-1",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionLaneSingle[1],
  ],
  compactSinglePositionLane2: [
    "--aries-wheel-compact-single-position-lane-2",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionLaneSingle[2],
  ],
  compactComparisonPositionLane0: [
    "--aries-wheel-compact-comparison-position-lane-0",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionLaneComparison[0],
  ],
  compactComparisonPositionLane1: [
    "--aries-wheel-compact-comparison-position-lane-1",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionLaneComparison[1],
  ],
  compactComparisonPositionLane2: [
    "--aries-wheel-compact-comparison-position-lane-2",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionLaneComparison[2],
  ],
  compactPositionInset: [
    "--aries-wheel-compact-position-inset",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionInset,
  ],
  compactPositionMinuteInsetSingle: [
    "--aries-wheel-compact-position-minute-inset-single",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionMinuteInsetSingle,
  ],
  compactPositionMinuteInsetWithOuter: [
    "--aries-wheel-compact-position-minute-inset-with-outer",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionMinuteInsetWithOuter,
  ],
  compactPositionMinuteInsetComparison: [
    "--aries-wheel-compact-position-minute-inset-comparison",
    COMPACT_WHEEL_GEOMETRY_PROFILE.positionMinuteInsetComparison,
  ],
  compactRetrogradeInset: [
    "--aries-wheel-compact-retrograde-inset",
    COMPACT_WHEEL_GEOMETRY_PROFILE.retrogradeInset,
  ],
  compactBase: ["--aries-wheel-compact-base", COMPACT_WHEEL_GEOMETRY_PROFILE.base],
  compactHouseSector: [
    "--aries-wheel-compact-house-sector",
    COMPACT_WHEEL_GEOMETRY_PROFILE.houseSector,
  ],
  compactHouseName: [
    "--aries-wheel-compact-house-name",
    COMPACT_WHEEL_GEOMETRY_PROFILE.houseName,
  ],
  angloZodiacSingle: [
    "--aries-wheel-anglo-zodiac-single",
    ANGLO_WHEEL_GEOMETRY_PROFILE.zodiacSingle,
  ],
  angloZodiacWithOuter: [
    "--aries-wheel-anglo-zodiac-with-outer",
    ANGLO_WHEEL_GEOMETRY_PROFILE.zodiacWithOuter,
  ],
  angloZodiacComparisonWithHouses: [
    "--aries-wheel-anglo-zodiac-comparison-with-houses",
    ANGLO_WHEEL_GEOMETRY_PROFILE.zodiacComparisonWithHouses,
  ],
  angloSubdivisionSector: [
    "--aries-wheel-anglo-subdivision-sector",
    ANGLO_WHEEL_GEOMETRY_PROFILE.subdivisionSector,
  ],
  angloSignInnerScale: [
    "--aries-wheel-anglo-sign-inner-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.signInnerScale,
  ],
  angloRulerBaseScale: [
    "--aries-wheel-anglo-ruler-base-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.rulerBaseScale,
  ],
  angloRulerSubdivisionScale: [
    "--aries-wheel-anglo-ruler-subdivision-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.rulerSubdivisionScale,
  ],
  angloCuspLabelScale: [
    "--aries-wheel-anglo-cusp-label-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.cuspLabelScale,
  ],
  angloInnerScale: [
    "--aries-wheel-anglo-inner-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.innerScale,
  ],
  angloPlanetScale: [
    "--aries-wheel-anglo-planet-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.planetScale,
  ],
  angloAspectScale: [
    "--aries-wheel-anglo-aspect-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.aspectScale,
  ],
  angloHouseScale: [
    "--aries-wheel-anglo-house-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.houseScale,
  ],
  angloLeaderInsetScale: [
    "--aries-wheel-anglo-leader-inset-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.leaderInsetScale,
  ],
  angloAspectLeaderInsetScale: [
    "--aries-wheel-anglo-aspect-leader-inset-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.aspectLeaderInsetScale,
  ],
  angloPositionInsetScale: [
    "--aries-wheel-anglo-position-inset-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.positionInsetScale,
  ],
  angloAnglePositionScale: [
    "--aries-wheel-anglo-angle-position-scale",
    ANGLO_WHEEL_GEOMETRY_PROFILE.anglePositionScale,
  ],
  angloArrowInset: [
    "--aries-wheel-anglo-arrow-inset",
    ANGLO_WHEEL_GEOMETRY_PROFILE.arrowInset,
  ],
  angloArrowMaximum: [
    "--aries-wheel-anglo-arrow-maximum",
    ANGLO_WHEEL_GEOMETRY_PROFILE.arrowMaximum,
  ],
  biwheelOuterMax: [
    "--aries-wheel-biwheel-outer-max",
    BIWHEEL_GEOMETRY_PROFILE.outerMax,
  ],
  biwheelOuterHouseSector: [
    "--aries-wheel-biwheel-outer-house-sector",
    BIWHEEL_GEOMETRY_PROFILE.outerHouseSector,
  ],
  biwheelZodiacInset: [
    "--aries-wheel-biwheel-zodiac-inset",
    BIWHEEL_GEOMETRY_PROFILE.zodiacInset,
  ],
  biwheelOuterPlanetSector: [
    "--aries-wheel-biwheel-outer-planet-sector",
    BIWHEEL_GEOMETRY_PROFILE.outerPlanetSector,
  ],
  biwheelOuterAngle: [
    "--aries-wheel-biwheel-outer-angle",
    BIWHEEL_GEOMETRY_PROFILE.outerAngle,
  ],
  biwheelArrowLength: [
    "--aries-wheel-biwheel-arrow-length",
    BIWHEEL_GEOMETRY_PROFILE.arrowLength,
  ],
  biwheelOuterLineOffset: [
    "--aries-wheel-biwheel-outer-line-offset",
    BIWHEEL_GEOMETRY_PROFILE.outerLineOffset,
  ],
  biwheelProjectedLabel: [
    "--aries-wheel-biwheel-projected-label",
    BIWHEEL_GEOMETRY_PROFILE.projectedLabel,
  ],
  biwheelRetrogradeOffset: [
    "--aries-wheel-biwheel-retrograde-offset",
    BIWHEEL_GEOMETRY_PROFILE.retrogradeOffset,
  ],
  biwheelOuterMinimum: [
    "--aries-wheel-biwheel-outer-minimum",
    BIWHEEL_GEOMETRY_PROFILE.outerMinimum,
  ],
  bodyScale: ["--aries-wheel-body-scale", DEFAULT_RATIOS.body],
  classicOuterScale: ["--aries-wheel-classic-outer-scale", DEFAULT_RATIOS.outer.classic],
  compactOuterScale: ["--aries-wheel-compact-outer-scale", DEFAULT_RATIOS.outer.compact],
  angloOuterScale: ["--aries-wheel-anglo-outer-scale", DEFAULT_RATIOS.outer.anglo],
  classicSignScale: ["--aries-wheel-classic-sign-scale", DEFAULT_RATIOS.sign.classic],
  compactSignScale: ["--aries-wheel-compact-sign-scale", DEFAULT_RATIOS.sign.compact],
  angloSignScale: ["--aries-wheel-anglo-sign-scale", DEFAULT_RATIOS.sign.anglo],
  classicSubdivisionScale: [
    "--aries-wheel-classic-subdivision-scale",
    DEFAULT_RATIOS.subdivision.classic,
  ],
  compactSubdivisionScale: [
    "--aries-wheel-compact-subdivision-scale",
    DEFAULT_RATIOS.subdivision.compact,
  ],
  angloSubdivisionScale: [
    "--aries-wheel-anglo-subdivision-scale",
    DEFAULT_RATIOS.subdivision.anglo,
  ],
  termGlyphScale: ["--aries-wheel-term-glyph-scale", DEFAULT_RATIOS.termGlyphScale],
  decanGlyphScale: ["--aries-wheel-decan-glyph-scale", DEFAULT_RATIOS.decanGlyphScale],
  angleLabelScale: ["--aries-wheel-angle-label-scale", DEFAULT_RATIOS.angleLabelScale],
  angleLabelWeight: ["--aries-wheel-angle-label-weight", DEFAULT_RATIOS.angleLabelWeight],
  syzygyScale: ["--aries-wheel-syzygy-scale", DEFAULT_RATIOS.syzygyScale],
  houseLabelScale: ["--aries-wheel-house-label-scale", DEFAULT_RATIOS.houseLabelScale],
  bodyPositionDegreeScale: [
    "--aries-wheel-body-position-degree-scale",
    DEFAULT_RATIOS.bodyPosition.degreeScale,
  ],
  bodyPositionSignScale: [
    "--aries-wheel-body-position-sign-scale",
    DEFAULT_RATIOS.bodyPosition.signScale,
  ],
  bodyPositionMinuteScale: [
    "--aries-wheel-body-position-minute-scale",
    DEFAULT_RATIOS.bodyPosition.minuteScale,
  ],
  anglePositionDegreeScale: [
    "--aries-wheel-angle-position-degree-scale",
    DEFAULT_RATIOS.anglePosition.degreeScale,
  ],
  anglePositionSignScale: [
    "--aries-wheel-angle-position-sign-scale",
    DEFAULT_RATIOS.anglePosition.signScale,
  ],
  anglePositionMinuteScale: [
    "--aries-wheel-angle-position-minute-scale",
    DEFAULT_RATIOS.anglePosition.minuteScale,
  ],
  housePositionDegreeScale: [
    "--aries-wheel-house-position-degree-scale",
    DEFAULT_RATIOS.housePosition.degreeScale,
  ],
  housePositionSignScale: [
    "--aries-wheel-house-position-sign-scale",
    DEFAULT_RATIOS.housePosition.signScale,
  ],
  housePositionMinuteScale: [
    "--aries-wheel-house-position-minute-scale",
    DEFAULT_RATIOS.housePosition.minuteScale,
  ],
  aspectGlyphScale: ["--aries-wheel-aspect-glyph-scale", DEFAULT_RATIOS.aspectGlyphScale],
  aspectGlyphOffsetScale: [
    "--aries-wheel-aspect-glyph-offset-scale",
    DEFAULT_RATIOS.aspectGlyphOffsetScale,
  ],
  motionScale: ["--aries-wheel-motion-scale", DEFAULT_RATIOS.motionScale],
  outerLabelScale: ["--aries-wheel-outer-label-scale", DEFAULT_RATIOS.outerLabelScale],
  outerProjectedGlyphScale: [
    "--aries-wheel-outer-projected-glyph-scale",
    DEFAULT_RATIOS.outerProjectedGlyphScale,
  ],
  angloBodyDegreeScale: [
    "--aries-wheel-anglo-body-degree-scale",
    DEFAULT_RATIOS.angloBodyPosition.degreeScale,
  ],
  angloBodySignScale: [
    "--aries-wheel-anglo-body-sign-scale",
    DEFAULT_RATIOS.angloBodyPosition.signScale,
  ],
  angloBodyMinuteScale: [
    "--aries-wheel-anglo-body-minute-scale",
    DEFAULT_RATIOS.angloBodyPosition.minuteScale,
  ],
  angloAnglePositionDegreeScale: [
    "--aries-wheel-anglo-angle-position-degree-scale",
    DEFAULT_RATIOS.angloAnglePosition.degreeScale,
  ],
  angloAnglePositionSignScale: [
    "--aries-wheel-anglo-angle-position-sign-scale",
    DEFAULT_RATIOS.angloAnglePosition.signScale,
  ],
  angloAnglePositionMinuteScale: [
    "--aries-wheel-anglo-angle-position-minute-scale",
    DEFAULT_RATIOS.angloAnglePosition.minuteScale,
  ],
  angloAnglePositionGapScale: [
    "--aries-wheel-anglo-angle-position-gap-scale",
    DEFAULT_RATIOS.angloAnglePosition.gapScale,
  ],
  angloHousePositionDegreeScale: [
    "--aries-wheel-anglo-house-position-degree-scale",
    DEFAULT_RATIOS.angloHousePosition.degreeScale,
  ],
  angloHousePositionSignScale: [
    "--aries-wheel-anglo-house-position-sign-scale",
    DEFAULT_RATIOS.angloHousePosition.signScale,
  ],
  angloHousePositionMinuteScale: [
    "--aries-wheel-anglo-house-position-minute-scale",
    DEFAULT_RATIOS.angloHousePosition.minuteScale,
  ],
  angloHousePositionGapScale: [
    "--aries-wheel-anglo-house-position-gap-scale",
    DEFAULT_RATIOS.angloHousePosition.gapScale,
  ],
  mediumStrokeBase: ["--aries-wheel-medium-stroke-base", DEFAULT_STROKES.mediumBase],
  hairlineStroke: ["--aries-wheel-hairline-stroke", DEFAULT_STROKES.hairline],
  angloStructuralStroke: [
    "--aries-wheel-anglo-structural-stroke",
    DEFAULT_STROKES.angloStructural,
  ],
  degreeTickStrokeSmall: [
    "--aries-wheel-degree-tick-stroke-small",
    DEFAULT_STROKES.degreeTick.small,
  ],
  degreeTickStrokeLarge: [
    "--aries-wheel-degree-tick-stroke-large",
    DEFAULT_STROKES.degreeTick.large,
  ],
  ascMcStrokeBase: ["--aries-wheel-asc-mc-stroke-base", DEFAULT_STROKES.ascMcDefaultBase],
  chartRingStrokeFallback: [
    "--aries-wheel-chart-ring-stroke-fallback",
    DEFAULT_STROKES.chartRing.fallbackBase,
  ],
  chartRingStrokeMin: [
    "--aries-wheel-chart-ring-stroke-min",
    DEFAULT_STROKES.chartRing.minBase,
  ],
  chartRingStrokeMax: [
    "--aries-wheel-chart-ring-stroke-max",
    DEFAULT_STROKES.chartRing.maxBase,
  ],
  aspectClassicWidth: [
    "--aries-wheel-aspect-classic-width",
    DEFAULT_STROKES.aspects.classicWidth,
  ],
  aspectAngloWidth: [
    "--aries-wheel-aspect-anglo-width",
    DEFAULT_STROKES.aspects.angloWidth,
  ],
  aspectClassicDashOn: [
    "--aries-wheel-aspect-classic-dash-on",
    DEFAULT_STROKES.aspects.classicDash[0],
  ],
  aspectClassicDashOff: [
    "--aries-wheel-aspect-classic-dash-off",
    DEFAULT_STROKES.aspects.classicDash[1],
  ],
  aspectAngloDashOn: [
    "--aries-wheel-aspect-anglo-dash-on",
    DEFAULT_STROKES.aspects.angloDash[0],
  ],
  aspectAngloDashOff: [
    "--aries-wheel-aspect-anglo-dash-off",
    DEFAULT_STROKES.aspects.angloDash[1],
  ],
  aspectClassicThicknessMin: [
    "--aries-wheel-aspect-classic-thickness-min",
    DEFAULT_STROKES.aspects.classicThicknessMin,
  ],
  aspectClassicThicknessMax: [
    "--aries-wheel-aspect-classic-thickness-max",
    DEFAULT_STROKES.aspects.classicThicknessMax,
  ],
  aspectClassicThicknessDefault: [
    "--aries-wheel-aspect-classic-thickness-default",
    DEFAULT_STROKES.aspects.classicThicknessNoOrb,
  ],
  aspectAngloThicknessMin: [
    "--aries-wheel-aspect-anglo-thickness-min",
    DEFAULT_STROKES.aspects.angloThicknessMin,
  ],
  aspectAngloThicknessMax: [
    "--aries-wheel-aspect-anglo-thickness-max",
    DEFAULT_STROKES.aspects.angloThicknessMin + DEFAULT_STROKES.aspects.angloThicknessSpan,
  ],
  aspectAngloThicknessDefault: [
    "--aries-wheel-aspect-anglo-thickness-default",
    DEFAULT_STROKES.aspects.angloThicknessNoOrb,
  ],
  houseClassicOffsetScale: [
    "--aries-wheel-house-classic-offset-scale",
    DEFAULT_LABELS.houseClassicOffsetScale,
  ],
  houseSecondOffsetScale: [
    "--aries-wheel-house-second-offset-scale",
    DEFAULT_LABELS.houseSecondOffsetScale,
  ],
  outerRadiusOffsetScale: [
    "--aries-wheel-outer-radius-offset-scale",
    DEFAULT_LABELS.outerRadiusOffsetScale,
  ],
  outerOutsidePadScale: [
    "--aries-wheel-outer-outside-pad-scale",
    DEFAULT_LABELS.outerOutsidePadScale,
  ],
  outerMotionRadiusScale: [
    "--aries-wheel-outer-motion-radius-scale",
    DEFAULT_LABELS.outerMotionRadiusScale,
  ],
  outerMotionOffsetScale: [
    "--aries-wheel-outer-motion-offset-scale",
    DEFAULT_LABELS.outerMotionOffsetScale,
  ],
  motionGapMin: ["--aries-wheel-motion-gap-min", DEFAULT_LABELS.motionGapMin],
  motionGapScale: ["--aries-wheel-motion-gap-scale", DEFAULT_LABELS.motionGapScale],
  motionRadialNudgeScale: [
    "--aries-wheel-motion-radial-nudge-scale",
    DEFAULT_LABELS.motionRadialNudgeScale,
  ],
  motionTangentNudgeScale: [
    "--aries-wheel-motion-tangent-nudge-scale",
    DEFAULT_LABELS.motionTangentNudgeScale,
  ],
  surveilTickLengthMin: [
    "--aries-wheel-surveil-tick-length-min",
    DEFAULT_LABELS.surveil.tickLengthMin,
  ],
  surveilTickLengthScale: [
    "--aries-wheel-surveil-tick-length-scale",
    DEFAULT_LABELS.surveil.tickLengthScale,
  ],
  surveilGlyphGapMin: [
    "--aries-wheel-surveil-glyph-gap-min",
    DEFAULT_LABELS.surveil.glyphGapMin,
  ],
  surveilGlyphGapScale: [
    "--aries-wheel-surveil-glyph-gap-scale",
    DEFAULT_LABELS.surveil.glyphGapScale,
  ],
  surveilGlyphSizeMin: [
    "--aries-wheel-surveil-glyph-size-min",
    DEFAULT_LABELS.surveil.glyphSizeMin,
  ],
  surveilGlyphSizeScale: [
    "--aries-wheel-surveil-glyph-size-scale",
    DEFAULT_LABELS.surveil.glyphSizeScale,
  ],
  surveilLabelGapMin: [
    "--aries-wheel-surveil-label-gap-min",
    DEFAULT_LABELS.surveil.labelGapMin,
  ],
  surveilLabelGapScale: [
    "--aries-wheel-surveil-label-gap-scale",
    DEFAULT_LABELS.surveil.labelGapScale,
  ],
  outerLabelEdgePadFactor: [
    "--aries-wheel-outer-label-edge-pad-factor",
    DEFAULT_OUTER_LABELS.edgePadFactor,
  ],
  overlayCompactBreakpoint: [
    "--aries-wheel-overlay-compact-breakpoint",
    DEFAULT_OVERLAYS.compactBreakpoint,
  ],
  overlayInfoFontMin: [
    "--aries-wheel-overlay-info-font-min",
    DEFAULT_OVERLAYS.infoFontMin,
  ],
  overlayInfoFontScale: [
    "--aries-wheel-overlay-info-font-scale",
    DEFAULT_OVERLAYS.infoFontScale,
  ],
  overlayCompactInfoFontMin: [
    "--aries-wheel-overlay-compact-info-font-min",
    DEFAULT_OVERLAYS.compactInfoFontMin,
  ],
  overlayCompactInfoFontScale: [
    "--aries-wheel-overlay-compact-info-font-scale",
    DEFAULT_OVERLAYS.compactInfoFontScale,
  ],
  overlayIconMin: [
    "--aries-wheel-overlay-icon-min",
    DEFAULT_OVERLAYS.iconMin,
  ],
  overlayIconScale: [
    "--aries-wheel-overlay-icon-scale",
    DEFAULT_OVERLAYS.iconScale,
  ],
  overlayCompactIconMin: [
    "--aries-wheel-overlay-compact-icon-min",
    DEFAULT_OVERLAYS.compactIconMin,
  ],
  overlayCompactIconScale: [
    "--aries-wheel-overlay-compact-icon-scale",
    DEFAULT_OVERLAYS.compactIconScale,
  ],
  overlayLabelMin: [
    "--aries-wheel-overlay-label-min",
    DEFAULT_OVERLAYS.labelMin,
  ],
  overlayLabelScale: [
    "--aries-wheel-overlay-label-scale",
    DEFAULT_OVERLAYS.labelScale,
  ],
  overlayCompactLabelMin: [
    "--aries-wheel-overlay-compact-label-min",
    DEFAULT_OVERLAYS.compactLabelMin,
  ],
  overlayCompactLabelScale: [
    "--aries-wheel-overlay-compact-label-scale",
    DEFAULT_OVERLAYS.compactLabelScale,
  ],
  overlayFontBoxScale: [
    "--aries-wheel-overlay-font-box-scale",
    DEFAULT_OVERLAYS.fontBoxScale,
  ],
  overlayRowHeightFactor: [
    "--aries-wheel-overlay-row-height-factor",
    DEFAULT_OVERLAYS.rowHeightFactor,
  ],
  overlayGapAfterDayHourScale: [
    "--aries-wheel-overlay-gap-after-day-hour-scale",
    DEFAULT_OVERLAYS.gapAfterDayHourScale,
  ],
  overlayGroupGapScale: [
    "--aries-wheel-overlay-group-gap-scale",
    DEFAULT_OVERLAYS.groupGapScale,
  ],
  overlayColumnGapMin: [
    "--aries-wheel-overlay-column-gap-min",
    DEFAULT_OVERLAYS.columnGapMin,
  ],
  overlayColumnGapScale: [
    "--aries-wheel-overlay-column-gap-scale",
    DEFAULT_OVERLAYS.columnGapScale,
  ],
  overlayEdgeInsetScale: [
    "--aries-wheel-overlay-edge-inset-scale",
    DEFAULT_OVERLAYS.edgeInsetScale,
  ],
  overlayCompactEdgeInsetMin: [
    "--aries-wheel-overlay-compact-edge-inset-min",
    DEFAULT_OVERLAYS.compactEdgeInsetMin,
  ],
  overlayTitlebarSafeTop: [
    "--aries-wheel-overlay-titlebar-safe-top",
    DEFAULT_OVERLAYS.titlebarSafeTop,
  ],
  overlayInfoGap: [
    "--aries-wheel-overlay-info-gap",
    DEFAULT_OVERLAYS.infoGap,
  ],
  overlayCornerLineHeight: [
    "--aries-wheel-overlay-corner-line-height",
    DEFAULT_OVERLAYS.cornerLineHeight,
  ],
  overlayGlyphLineHeight: [
    "--aries-wheel-overlay-glyph-line-height",
    DEFAULT_OVERLAYS.glyphLineHeight,
  ],
  overlayMaxWidthViewportScale: [
    "--aries-wheel-overlay-max-width-viewport-scale",
    DEFAULT_OVERLAYS.maxWidthViewportScale,
  ],
  ...wheelLinePaintTokenSpecs(),
  ...wheelRingRadiusTokenSpecs(),
});

/**
 * Sparse pre-profile-v2 drafts may still carry the old Anglo-only sign metric
 * ids. Migrate those authored keys to the canonical semantic position metrics;
 * runtime paint deliberately has one authority and never guesses authorship by
 * comparing a resolved value with its default.
 */
export const WHEEL_RENDER_DEPRECATED_TOKEN_ALIASES = deepFreeze({
  angloBodySignScale: "bodyPositionSignScale",
  angloAnglePositionSignScale: "anglePositionSignScale",
  angloHousePositionSignScale: "housePositionSignScale",
} as const satisfies Readonly<
  Partial<Record<keyof WheelRenderTokens, keyof WheelRenderTokens>>
>);

function defaultWheelRenderTokens(): Readonly<WheelRenderTokens> {
  const tokens = {} as WheelRenderTokens;
  for (const key of Object.keys(WHEEL_RENDER_TOKEN_SPECS) as Array<keyof WheelRenderTokens>) {
    tokens[key] = WHEEL_RENDER_TOKEN_SPECS[key][1];
  }
  return deepFreeze(tokens);
}

export const DEFAULT_WHEEL_RENDER_TOKENS = defaultWheelRenderTokens();

const POSITIVE_WHEEL_RENDER_TOKEN_KEYS = new Set<keyof WheelRenderTokens>([
  "bodyScale",
  "classicOuterScale",
  "compactOuterScale",
  "angloOuterScale",
  "classicSignScale",
  "compactSignScale",
  "angloSignScale",
  "classicSubdivisionScale",
  "compactSubdivisionScale",
  "angloSubdivisionScale",
  "termGlyphScale",
  "decanGlyphScale",
  "angleLabelScale",
  "angleLabelWeight",
  "syzygyScale",
  "houseLabelScale",
  "bodyPositionDegreeScale",
  "bodyPositionSignScale",
  "bodyPositionMinuteScale",
  "anglePositionDegreeScale",
  "anglePositionSignScale",
  "anglePositionMinuteScale",
  "housePositionDegreeScale",
  "housePositionSignScale",
  "housePositionMinuteScale",
  "aspectGlyphScale",
  "motionScale",
  "outerLabelScale",
  "outerProjectedGlyphScale",
  "angloBodyDegreeScale",
  "angloBodySignScale",
  "angloBodyMinuteScale",
  "angloAnglePositionDegreeScale",
  "angloAnglePositionSignScale",
  "angloAnglePositionMinuteScale",
  "angloHousePositionDegreeScale",
  "angloHousePositionSignScale",
  "angloHousePositionMinuteScale",
  "mediumStrokeBase",
  "hairlineStroke",
  "angloStructuralStroke",
  "degreeTickStrokeSmall",
  "degreeTickStrokeLarge",
  "ascMcStrokeBase",
  "chartRingStrokeFallback",
  "chartRingStrokeMin",
  "chartRingStrokeMax",
  "aspectClassicWidth",
  "aspectAngloWidth",
  "aspectClassicDashOn",
  "aspectClassicDashOff",
  "aspectAngloDashOn",
  "aspectAngloDashOff",
  "aspectClassicThicknessMin",
  "aspectClassicThicknessMax",
  "aspectClassicThicknessDefault",
  "aspectAngloThicknessMin",
  "aspectAngloThicknessMax",
  "aspectAngloThicknessDefault",
  "motionRadialNudgeScale",
  "motionTangentNudgeScale",
  "surveilTickLengthMin",
  "surveilTickLengthScale",
  "surveilGlyphSizeMin",
  "surveilGlyphSizeScale",
  "overlayCompactBreakpoint",
  "overlayInfoFontMin",
  "overlayInfoFontScale",
  "overlayCompactInfoFontMin",
  "overlayCompactInfoFontScale",
  "overlayIconMin",
  "overlayIconScale",
  "overlayCompactIconMin",
  "overlayCompactIconScale",
  "overlayLabelMin",
  "overlayLabelScale",
  "overlayCompactLabelMin",
  "overlayCompactLabelScale",
  "overlayFontBoxScale",
  "overlayRowHeightFactor",
  "overlayCornerLineHeight",
  "overlayGlyphLineHeight",
  "overlayMaxWidthViewportScale",
  ...WHEEL_LINE_PAINT_ROLES.flatMap((role) => [
    wheelLinePaintTokenKey(role, "WidthScale"),
    wheelLinePaintTokenKey(role, "DashOn"),
    wheelLinePaintTokenKey(role, "DashOff"),
  ]),
]);

export const WHEEL_RENDER_TOKEN_RANGES: ReadonlyMap<
  keyof WheelRenderTokens,
  readonly [minimum: number, maximum: number]
> = new Map([
  // Direct normalized glyph sizes are tightly bounded. A previous public max
  // of 1 allowed one glyph to become as large as the full wheel radius and
  // drove collision scheduling into pathological work.
  ["bodyScale", [0.025, 0.125]],
  ["classicOuterScale", [0.025, 0.125]],
  ["compactOuterScale", [0.025, 0.125]],
  ["angloOuterScale", [0.025, 0.125]],
  ["classicDegreeTickLength", [0.002, 0.03]],
  ["classicSignSectorLength", [0.05, 0.28]],
  ["classicPlanetSectorLength", [0.05, 0.3]],
  ["classicTermSectorLength", [0.015, 0.16]],
  ["classicDecanSectorLength", [0.015, 0.16]],
  ["classicPlanetLineLength", [0.005, 0.08]],
  ["classicRetrogradeOffset", [0.002, 0.06]],
  ["classicArrowLength", [0.01, 0.1]],
  ["classicHouseSectorLength", [0.02, 0.14]],
  ["classicOuterZodiac", [0.65, 0.95]],
  ["classicOuterLine", [0.65, 1.05]],
  ["classicOuterProjectedLabel", [0.65, 1.15]],
  ["classicOuterProjectedLine", [0.65, 1.05]],
  ["classicInnerPosition", [0.2, 0.7]],
  ["classicInnerAspectAngle", [0.15, 0.65]],
  ["classicInnerPositionAngle", [0.12, 0.62]],
  ["classicInnerPositionHouses", [0.1, 0.55]],
  ["classicInnerBase", [0.03, 0.3]],
  ["classicInnerHouseName", [0.04, 0.4]],
  ["compactSinglePositionLane0", [0.12, 0.6]],
  ["compactSinglePositionLane1", [0.1, 0.55]],
  ["compactSinglePositionLane2", [0.08, 0.5]],
  ["compactComparisonPositionLane0", [0.12, 0.6]],
  ["compactComparisonPositionLane1", [0.1, 0.55]],
  ["compactComparisonPositionLane2", [0.08, 0.5]],
  ["compactPositionInset", [0.05, 0.3]],
  ["compactPositionMinuteInsetSingle", [0.01, 0.15]],
  ["compactPositionMinuteInsetWithOuter", [0.01, 0.15]],
  ["compactPositionMinuteInsetComparison", [0.01, 0.15]],
  ["compactRetrogradeInset", [0.01, 0.15]],
  ["compactBase", [0.05, 0.35]],
  ["compactHouseSector", [0.02, 0.15]],
  ["compactHouseName", [0.07, 0.45]],
  ["angloZodiacSingle", [0.6, 0.98]],
  ["angloZodiacWithOuter", [0.6, 0.98]],
  ["angloZodiacComparisonWithHouses", [0.55, 0.95]],
  ["angloSubdivisionSector", [0.01, 0.1]],
  ["angloSignInnerScale", [0.65, 0.98]],
  ["angloRulerBaseScale", [0.02, 0.15]],
  ["angloRulerSubdivisionScale", [0.001, 0.05]],
  ["angloCuspLabelScale", [0.45, 0.95]],
  ["angloInnerScale", [0.4, 0.9]],
  ["angloPlanetScale", [0.3, 0.85]],
  ["angloAspectScale", [0.1, 0.7]],
  ["angloHouseScale", [0.15, 0.75]],
  ["angloLeaderInsetScale", [0.005, 0.12]],
  ["angloAspectLeaderInsetScale", [0.005, 0.12]],
  ["angloPositionInsetScale", [0.01, 0.2]],
  ["angloAnglePositionScale", [0.2, 0.75]],
  ["angloArrowInset", [0.005, 0.1]],
  ["angloArrowMaximum", [0.9, 1]],
  ["biwheelOuterMax", [0.85, 1]],
  ["biwheelOuterHouseSector", [0.02, 0.12]],
  ["biwheelZodiacInset", [0.05, 0.25]],
  ["biwheelOuterPlanetSector", [0.05, 0.25]],
  ["biwheelOuterAngle", [0.75, 0.99]],
  ["biwheelArrowLength", [0.005, 0.1]],
  ["biwheelOuterLineOffset", [0, 0.1]],
  ["biwheelProjectedLabel", [0.7, 1.05]],
  ["biwheelRetrogradeOffset", [0, 0.08]],
  ["biwheelOuterMinimum", [0.6, 0.9]],
  ["termGlyphScale", [0.25, 3]],
  ["decanGlyphScale", [0.25, 3]],
  ["bodyPositionSignScale", [0.14, 1.69]],
  ["anglePositionSignScale", [0.13, 1.56]],
  ["housePositionSignScale", [0.13, 1.56]],
  ["outerProjectedGlyphScale", [0.25, 3]],
  ["angleLabelWeight", [1, 1000]],
  ["overlayCompactBreakpoint", [240, 800]],
  ["overlayInfoFontMin", [6, 32]],
  ["overlayInfoFontScale", [0.2, 2]],
  ["overlayCompactInfoFontMin", [6, 32]],
  ["overlayCompactInfoFontScale", [0.2, 2]],
  ["overlayIconMin", [6, 48]],
  ["overlayIconScale", [0.2, 2]],
  ["overlayCompactIconMin", [6, 48]],
  ["overlayCompactIconScale", [0.2, 2]],
  ["overlayLabelMin", [6, 32]],
  ["overlayLabelScale", [0.1, 2]],
  ["overlayCompactLabelMin", [6, 32]],
  ["overlayCompactLabelScale", [0.1, 2]],
  ["overlayFontBoxScale", [0.5, 2]],
  ["overlayRowHeightFactor", [0.5, 2]],
  ["overlayGapAfterDayHourScale", [0, 2]],
  ["overlayGroupGapScale", [0, 2]],
  ["overlayColumnGapMin", [0, 24]],
  ["overlayColumnGapScale", [0, 2]],
  ["overlayEdgeInsetScale", [0, 0.2]],
  ["overlayCompactEdgeInsetMin", [0, 48]],
  ["overlayTitlebarSafeTop", [0, 48]],
  ["overlayInfoGap", [0, 24]],
  ["overlayCornerLineHeight", [0.5, 2]],
  ["overlayGlyphLineHeight", [0.5, 2]],
  ["overlayMaxWidthViewportScale", [0.2, 1]],
  ...WHEEL_LINE_PAINT_ROLES.flatMap(
    (role): Array<readonly [keyof WheelRenderTokens, readonly [number, number]]> => [
      [wheelLinePaintTokenKey(role, "WidthScale"), [0.25, 4]],
      [wheelLinePaintTokenKey(role, "Pattern"), [0, 3]],
      [wheelLinePaintTokenKey(role, "DashOn"), [0.25, 40]],
      [wheelLinePaintTokenKey(role, "DashOff"), [0.25, 40]],
      [wheelLinePaintTokenKey(role, "Opacity"), [0, 1]],
    ],
  ),
  ...(["classic", "compact", "anglo"] as const).flatMap(
    (profile): Array<readonly [keyof WheelRenderTokens, readonly [number, number]]> =>
      WHEEL_PAINTED_RING_ROLES.map((role) => [
        wheelRingRadiusTokenKey(profile, role),
        [0, 1],
      ]),
  ),
]);

function resetWheelTokenGroup(
  tokens: WheelRenderTokens,
  keys: readonly (keyof WheelRenderTokens)[],
): void {
  for (const key of keys) tokens[key] = WHEEL_RENDER_TOKEN_SPECS[key][1];
}

const CLASSIC_GEOMETRY_TOKEN_KEYS = [
  "classicDegreeTickLength",
  "classicSignSectorLength",
  "classicPlanetSectorLength",
  "classicTermSectorLength",
  "classicDecanSectorLength",
  "classicPlanetLineLength",
  "classicRetrogradeOffset",
  "classicArrowLength",
  "classicHouseSectorLength",
  "classicOuterZodiac",
  "classicOuterLine",
  "classicOuterProjectedLabel",
  "classicOuterProjectedLine",
  "classicInnerPosition",
  "classicInnerAspectAngle",
  "classicInnerPositionAngle",
  "classicInnerPositionHouses",
  "classicInnerBase",
  "classicInnerHouseName",
] as const satisfies readonly (keyof WheelRenderTokens)[];

const COMPACT_GEOMETRY_TOKEN_KEYS = [
  "compactSinglePositionLane0",
  "compactSinglePositionLane1",
  "compactSinglePositionLane2",
  "compactComparisonPositionLane0",
  "compactComparisonPositionLane1",
  "compactComparisonPositionLane2",
  "compactPositionInset",
  "compactPositionMinuteInsetSingle",
  "compactPositionMinuteInsetWithOuter",
  "compactPositionMinuteInsetComparison",
  "compactRetrogradeInset",
  "compactBase",
  "compactHouseSector",
  "compactHouseName",
] as const satisfies readonly (keyof WheelRenderTokens)[];

const ANGLO_GEOMETRY_TOKEN_KEYS = [
  "angloZodiacSingle",
  "angloZodiacWithOuter",
  "angloZodiacComparisonWithHouses",
  "angloSubdivisionSector",
  "angloSignInnerScale",
  "angloRulerBaseScale",
  "angloRulerSubdivisionScale",
  "angloCuspLabelScale",
  "angloInnerScale",
  "angloPlanetScale",
  "angloAspectScale",
  "angloHouseScale",
  "angloLeaderInsetScale",
  "angloAspectLeaderInsetScale",
  "angloPositionInsetScale",
  "angloAnglePositionScale",
  "angloArrowInset",
  "angloArrowMaximum",
] as const satisfies readonly (keyof WheelRenderTokens)[];

const BIWHEEL_GEOMETRY_TOKEN_KEYS = [
  "biwheelOuterMax",
  "biwheelOuterHouseSector",
  "biwheelZodiacInset",
  "biwheelOuterPlanetSector",
  "biwheelOuterAngle",
  "biwheelArrowLength",
  "biwheelOuterLineOffset",
  "biwheelProjectedLabel",
  "biwheelRetrogradeOffset",
  "biwheelOuterMinimum",
] as const satisfies readonly (keyof WheelRenderTokens)[];

const WHEEL_RING_RADIUS_TOKEN_KEYS = (
  ["classic", "compact", "anglo"] as const
).flatMap((profile) =>
  WHEEL_PAINTED_RING_ROLES.map((role) => wheelRingRadiusTokenKey(profile, role)),
);

/**
 * Explicit source units beat name inference in the generated CSS/public
 * contract. These renderer values are normalized wheel fractions, never CSS
 * pixels; Profile V2 exposes painted ring radii separately in chart-px.
 */
export const WHEEL_RENDER_TOKEN_UNIT_OVERRIDES = deepFreeze(
  Object.fromEntries(
    [
      ...CLASSIC_GEOMETRY_TOKEN_KEYS,
      ...COMPACT_GEOMETRY_TOKEN_KEYS,
      ...ANGLO_GEOMETRY_TOKEN_KEYS,
      ...BIWHEEL_GEOMETRY_TOKEN_KEYS,
      ...WHEEL_RING_RADIUS_TOKEN_KEYS,
    ].map((key) => [key, ""] as const),
  ),
) as Readonly<Partial<Record<keyof WheelRenderTokens, "" | "px" | "deg">>>;

/**
 * Compatibility/sentinel ratios remain valid runtime CSS inputs but are not
 * authoring controls. Canonical painted-ring editing is the Profile V2
 * `radius` property in conventional chart pixels.
 */
export const WHEEL_RENDER_INTERNAL_TOKEN_KEYS = deepFreeze([
  ...Object.keys(WHEEL_RENDER_DEPRECATED_TOKEN_ALIASES),
  ...WHEEL_RING_RADIUS_TOKEN_KEYS,
] as Array<keyof WheelRenderTokens>);

function strictlyDescending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] > value);
}

function safeClassicGeometryTokens(tokens: WheelRenderTokens): boolean {
  const defaults = DEFAULT_WHEEL_GEOMETRY_PROFILES.classic;
  const deltas: WheelPositionLane = {
    position: tokens.classicInnerPosition - defaults.inner.position,
    aspectAngle: tokens.classicInnerAspectAngle - defaults.inner.aspectAngle,
    positionAngle: tokens.classicInnerPositionAngle - defaults.inner.positionAngle,
    positionHouses: tokens.classicInnerPositionHouses - defaults.inner.positionHouses,
  };
  const lanes = [...defaults.singlePositionLanes, ...defaults.comparisonPositionLanes].map(
    (lane) => ({
      position: lane.position + deltas.position,
      aspectAngle: lane.aspectAngle + deltas.aspectAngle,
      positionAngle: lane.positionAngle + deltas.positionAngle,
      positionHouses: lane.positionHouses + deltas.positionHouses,
    }),
  );
  const houseOuter = tokens.classicInnerBase + tokens.classicHouseSectorLength;
  const aspectFloor =
    tokens.classicOuterZodiac -
    tokens.classicSignSectorLength -
    tokens.classicTermSectorLength -
    tokens.classicDecanSectorLength -
    tokens.classicPlanetSectorLength;
  return (
    tokens.classicOuterLine >= tokens.classicOuterZodiac &&
    tokens.classicOuterProjectedLine >= tokens.classicOuterZodiac &&
    tokens.classicOuterProjectedLine <= tokens.classicOuterProjectedLabel &&
    tokens.classicOuterProjectedLabel >= tokens.classicOuterLine &&
    tokens.classicDegreeTickLength * 3 < tokens.classicSignSectorLength &&
    tokens.classicPlanetLineLength < tokens.classicPlanetSectorLength / 2 &&
    tokens.classicInnerBase < tokens.classicInnerHouseName &&
    tokens.classicInnerHouseName < houseOuter &&
    aspectFloor > houseOuter + 0.02 &&
    lanes.every(
      (lane) =>
        lane.position > lane.aspectAngle &&
        lane.aspectAngle >= lane.positionAngle &&
        lane.positionAngle > lane.positionHouses &&
        lane.positionHouses > houseOuter,
    )
  );
}

function safeCompactGeometryTokens(tokens: WheelRenderTokens): boolean {
  const single = [
    tokens.compactSinglePositionLane0,
    tokens.compactSinglePositionLane1,
    tokens.compactSinglePositionLane2,
  ];
  const comparison = [
    tokens.compactComparisonPositionLane0,
    tokens.compactComparisonPositionLane1,
    tokens.compactComparisonPositionLane2,
  ];
  const houseOuter = tokens.compactBase + tokens.compactHouseSector;
  return (
    strictlyDescending(single) &&
    strictlyDescending(comparison) &&
    tokens.compactBase < tokens.compactHouseName &&
    tokens.compactHouseName < houseOuter &&
    tokens.compactPositionInset +
      Math.max(
        tokens.compactPositionMinuteInsetSingle,
        tokens.compactPositionMinuteInsetWithOuter,
        tokens.compactPositionMinuteInsetComparison,
      ) +
      tokens.compactRetrogradeInset <
      0.5
  );
}

function safeAngloGeometryTokens(tokens: WheelRenderTokens): boolean {
  return (
    tokens.angloSignInnerScale > tokens.angloCuspLabelScale &&
    tokens.angloCuspLabelScale > tokens.angloInnerScale &&
    tokens.angloInnerScale > tokens.angloPlanetScale &&
    tokens.angloPlanetScale > tokens.angloHouseScale &&
    tokens.angloHouseScale > tokens.angloAspectScale &&
    tokens.angloAnglePositionScale > tokens.angloAspectScale &&
    tokens.angloAnglePositionScale < tokens.angloPlanetScale &&
    tokens.angloRulerBaseScale > tokens.angloRulerSubdivisionScale * 2 &&
    tokens.angloPositionInsetScale <
      tokens.angloPlanetScale - tokens.angloAspectScale &&
    tokens.angloSubdivisionSector * 2 < tokens.angloSignInnerScale &&
    tokens.angloArrowMaximum >=
      Math.max(
        tokens.angloZodiacSingle,
        tokens.angloZodiacWithOuter,
        tokens.angloZodiacComparisonWithHouses,
      )
  );
}

function safeBiwheelGeometryTokens(tokens: WheelRenderTokens): boolean {
  const zodiacWithHouses =
    tokens.biwheelOuterMax -
    tokens.biwheelOuterHouseSector -
    tokens.biwheelZodiacInset;
  return (
    tokens.biwheelOuterMax > tokens.biwheelOuterAngle &&
    tokens.biwheelOuterMax > tokens.biwheelProjectedLabel &&
    tokens.biwheelProjectedLabel > tokens.biwheelOuterMinimum &&
    zodiacWithHouses > tokens.biwheelOuterMinimum &&
    zodiacWithHouses + tokens.biwheelOuterLineOffset < tokens.biwheelOuterMax &&
    tokens.biwheelOuterAngle + tokens.biwheelArrowLength <= 1.02 &&
    tokens.biwheelOuterPlanetSector < tokens.biwheelOuterMax - tokens.biwheelOuterMinimum
  );
}

/** Resolve daemon/profile CSS-number strings without reading mutable DOM state. */
export function resolveWheelRenderTokens(
  readValue: WheelCssValueReader = () => "",
): Readonly<WheelRenderTokens> {
  const keys = Object.keys(WHEEL_RENDER_TOKEN_SPECS) as Array<keyof WheelRenderTokens>;
  const rawValues = new Map<keyof WheelRenderTokens, string>();
  for (const key of keys) {
    const cssVar = WHEEL_RENDER_TOKEN_SPECS[key][0];
    rawValues.set(key, (readValue(cssVar) ?? "").trim());
  }
  for (const [deprecatedKey, canonicalKey] of Object.entries(
    WHEEL_RENDER_DEPRECATED_TOKEN_ALIASES,
  ) as Array<[keyof WheelRenderTokens, keyof WheelRenderTokens]>) {
    if (!rawValues.get(canonicalKey) && rawValues.get(deprecatedKey)) {
      rawValues.set(canonicalKey, rawValues.get(deprecatedKey) ?? "");
    }
  }

  const tokens = {} as WheelRenderTokens;
  for (const key of keys) {
    const fallback = WHEEL_RENDER_TOKEN_SPECS[key][1];
    const value = Number.parseFloat(rawValues.get(key) ?? "");
    const range = WHEEL_RENDER_TOKEN_RANGES.get(key);
    const validPattern = !String(key).endsWith("Pattern") || Number.isInteger(value);
    const valid =
      Number.isFinite(value) &&
      validPattern &&
      (POSITIVE_WHEEL_RENDER_TOKEN_KEYS.has(key) ? value > 0 : value >= 0) &&
      (!range || (value >= range[0] && value <= range[1]));
    tokens[key] = valid ? value : fallback;
  }

  if (tokens.degreeTickStrokeSmall > tokens.degreeTickStrokeLarge) {
    resetWheelTokenGroup(tokens, ["degreeTickStrokeSmall", "degreeTickStrokeLarge"]);
  }
  if (
    tokens.chartRingStrokeMin > tokens.chartRingStrokeMax ||
    tokens.chartRingStrokeFallback < tokens.chartRingStrokeMin ||
    tokens.chartRingStrokeFallback > tokens.chartRingStrokeMax
  ) {
    resetWheelTokenGroup(tokens, [
      "chartRingStrokeFallback",
      "chartRingStrokeMin",
      "chartRingStrokeMax",
    ]);
  }
  if (
    tokens.aspectClassicThicknessMin > tokens.aspectClassicThicknessMax ||
    tokens.aspectClassicThicknessDefault < tokens.aspectClassicThicknessMin ||
    tokens.aspectClassicThicknessDefault > tokens.aspectClassicThicknessMax
  ) {
    resetWheelTokenGroup(tokens, [
      "aspectClassicThicknessMin",
      "aspectClassicThicknessMax",
      "aspectClassicThicknessDefault",
    ]);
  }
  if (
    tokens.aspectAngloThicknessMin > tokens.aspectAngloThicknessMax ||
    tokens.aspectAngloThicknessDefault < tokens.aspectAngloThicknessMin ||
    tokens.aspectAngloThicknessDefault > tokens.aspectAngloThicknessMax
  ) {
    resetWheelTokenGroup(tokens, [
      "aspectAngloThicknessMin",
      "aspectAngloThicknessMax",
      "aspectAngloThicknessDefault",
    ]);
  }
  if (!safeClassicGeometryTokens(tokens)) {
    resetWheelTokenGroup(tokens, CLASSIC_GEOMETRY_TOKEN_KEYS);
  }
  if (!safeCompactGeometryTokens(tokens)) {
    resetWheelTokenGroup(tokens, COMPACT_GEOMETRY_TOKEN_KEYS);
  }
  if (!safeAngloGeometryTokens(tokens)) {
    resetWheelTokenGroup(tokens, ANGLO_GEOMETRY_TOKEN_KEYS);
  }
  if (!safeBiwheelGeometryTokens(tokens)) {
    resetWheelTokenGroup(tokens, BIWHEEL_GEOMETRY_TOKEN_KEYS);
  }

  return deepFreeze(tokens);
}

export type WheelRenderStyleInput = {
  palette: ChartPalette;
  elementColors?: WheelElementColors;
  revision?: WheelStyleRevision;
  fontUi?: string;
  fontSymbols?: string;
  fontBodySymbols?: string;
  fontSignSymbols?: string;
  fontTermSymbols?: string;
  fontDecanSymbols?: string;
  fontAspectSymbols?: string;
  geometry?: WheelGeometryProfiles;
  ringRadiusOverrides?: WheelRingRadiusOverrides;
  authoringOverrides?: WheelAuthoringOverrides;
  authoringTargetRadius?: number;
  authoringTargetProfile?: WheelTypographyProfile;
  typographyRatios?: WheelTypographyRatios;
  strokes?: WheelStrokeStyle;
  linePaint?: WheelLinePaintStyle;
  labels?: WheelLabelStyle;
  collision?: WheelCollisionStyle;
  hit?: WheelHitStyle;
  overlays?: WheelOverlayStyle;
  outerLabels?: WheelRenderStyle["outerLabels"];
};

export function createWheelRenderStyle({
  palette,
  elementColors = elementColorsFromPalette(palette),
  revision = DEFAULT_WHEEL_RENDER_STYLE.revision,
  fontUi = DEFAULT_WHEEL_RENDER_STYLE.typography.families.ui,
  fontSymbols = DEFAULT_WHEEL_RENDER_STYLE.typography.families.symbols,
  fontBodySymbols = fontSymbols,
  fontSignSymbols = fontSymbols,
  fontTermSymbols = fontSymbols,
  fontDecanSymbols = fontSymbols,
  fontAspectSymbols = fontSymbols,
  geometry = DEFAULT_WHEEL_RENDER_STYLE.geometry,
  ringRadiusOverrides = DEFAULT_WHEEL_RENDER_STYLE.ringRadiusOverrides,
  authoringOverrides = DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
  authoringTargetRadius = authoringOverrides.referenceRadius,
  authoringTargetProfile = DEFAULT_WHEEL_RENDER_STYLE.authoringTargetProfile,
  typographyRatios = DEFAULT_WHEEL_RENDER_STYLE.typography.ratios,
  strokes = DEFAULT_WHEEL_RENDER_STYLE.strokes,
  linePaint = DEFAULT_WHEEL_RENDER_STYLE.linePaint,
  labels = DEFAULT_WHEEL_RENDER_STYLE.labels,
  collision = DEFAULT_WHEEL_RENDER_STYLE.collision,
  hit = DEFAULT_WHEEL_RENDER_STYLE.hit,
  overlays = DEFAULT_WHEEL_RENDER_STYLE.overlays,
  outerLabels = DEFAULT_WHEEL_RENDER_STYLE.outerLabels,
}: WheelRenderStyleInput): WheelRenderStyle {
  return deepFreeze({
    schemaVersion: WHEEL_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: immutablePalette(palette),
    elementColors: immutableCopy(elementColors),
    geometry: immutableCopy(geometry),
    ringRadiusOverrides: immutableCopy(ringRadiusOverrides),
    authoringOverrides: immutableCopy(authoringOverrides),
    authoringTargetRadius,
    authoringTargetProfile,
    typography: {
      families: {
        ui: fontUi,
        symbols: fontSymbols,
        bodySymbols: fontBodySymbols,
        signSymbols: fontSignSymbols,
        termSymbols: fontTermSymbols,
        decanSymbols: fontDecanSymbols,
        aspectSymbols: fontAspectSymbols,
      },
      ratios: immutableCopy(typographyRatios),
    },
    strokes: immutableCopy(strokes),
    linePaint: immutableCopy(linePaint),
    labels: immutableCopy(labels),
    collision: immutableCopy(collision),
    hit: immutableCopy(hit),
    overlays: immutableCopy(overlays),
    outerLabels: immutableCopy(outerLabels),
  });
}

export function hasWheelAuthoringOverrides(
  overrides: WheelAuthoringOverrides,
): boolean {
  const profileHasValues = (profiles: Readonly<Record<string, unknown>>) =>
    Object.values(profiles).some(
      (value) => value != null && typeof value === "object" && Object.keys(value).length > 0,
    );
  return profileHasValues(overrides.typography)
    || profileHasValues(overrides.linePaint)
    || profileHasValues(overrides.fillPaint)
    || profileHasValues(overrides.ringRadii);
}

/**
 * Bind sparse profile-v2 source to one renderer target. The source remains in
 * reference chart pixels; only the transient target/profile changes. With no
 * v2 values this returns the original style, preserving production defaults
 * and avoiding work on ordinary Aries charts.
 */
export function projectWheelAuthoringStyle(
  style: WheelRenderStyle,
  targetWheelRadius: number,
  profile: WheelTypographyProfile,
): WheelRenderStyle {
  if (!hasWheelAuthoringOverrides(style.authoringOverrides)) return style;
  const safeTarget = Number.isFinite(targetWheelRadius) && targetWheelRadius >= 0
    ? targetWheelRadius
    : safeAuthoringReferenceRadius(style);
  if (
    style.authoringTargetRadius === safeTarget
    && style.authoringTargetProfile === profile
  ) {
    return style;
  }
  return deepFreeze({
    ...style,
    authoringTargetRadius: safeTarget,
    authoringTargetProfile: profile,
  });
}

export type TokenizedWheelRenderStyleInput = Readonly<{
  palette?: ChartPalette;
  elementColors?: WheelElementColors;
  revision?: WheelStyleRevision;
  fontUi?: string;
  fontSymbols?: string;
  fontBodySymbols?: string;
  fontSignSymbols?: string;
  fontTermSymbols?: string;
  fontDecanSymbols?: string;
  fontAspectSymbols?: string;
  authoringOverrides?: WheelAuthoringOverrides;
  authoringTargetRadius?: number;
  authoringTargetProfile?: WheelTypographyProfile;
  tokens?: Readonly<WheelRenderTokens>;
}>;

function linePaintFromTokens(tokens: Readonly<WheelRenderTokens>): WheelLinePaintStyle {
  return Object.fromEntries(
    WHEEL_LINE_PAINT_ROLES.map((role) => [
      role,
      {
        widthScale: tokens[wheelLinePaintTokenKey(role, "WidthScale")],
        pattern: tokens[
          wheelLinePaintTokenKey(role, "Pattern")
        ] as WheelLinePattern,
        dashOn: tokens[wheelLinePaintTokenKey(role, "DashOn")],
        dashOff: tokens[wheelLinePaintTokenKey(role, "DashOff")],
        opacity: tokens[wheelLinePaintTokenKey(role, "Opacity")],
      },
    ]),
  ) as Record<WheelLinePaintRole, WheelLinePaintRoleStyle>;
}

function ringRadiusOverridesFromTokens(
  tokens: Readonly<WheelRenderTokens>,
): WheelRingRadiusOverrides {
  return Object.fromEntries(
    (["classic", "compact", "anglo"] as const).map((profile) => [
      profile,
      Object.fromEntries(
        WHEEL_PAINTED_RING_ROLES.map((role) => [
          role,
          tokens[wheelRingRadiusTokenKey(profile, role)],
        ]),
      ),
    ]),
  ) as Record<
    WheelTypographyProfile,
    Record<WheelPaintedRingRole, number>
  >;
}

/**
 * Apply only the daemon-authorable visual subset. Public geometry remains a
 * bounded set of canonical normalized inputs; collision and hit profiles stay
 * on the frozen internal contract.
 */
export function createTokenizedWheelRenderStyle({
  palette = DEFAULT_PALETTE,
  elementColors = elementColorsFromPalette(palette),
  revision = DEFAULT_REVISION,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  fontBodySymbols = fontSymbols,
  fontSignSymbols = fontSymbols,
  fontTermSymbols = fontSymbols,
  fontDecanSymbols = fontSymbols,
  fontAspectSymbols = fontSymbols,
  authoringOverrides = DEFAULT_WHEEL_AUTHORING_OVERRIDES,
  authoringTargetRadius = authoringOverrides.referenceRadius,
  authoringTargetProfile = "classic",
  tokens = DEFAULT_WHEEL_RENDER_TOKENS,
}: TokenizedWheelRenderStyleInput = {}): WheelRenderStyle {
  const baseGeometry = DEFAULT_WHEEL_RENDER_STYLE.geometry;
  const positionDeltas: WheelPositionLane = {
    position: tokens.classicInnerPosition - baseGeometry.classic.inner.position,
    aspectAngle:
      tokens.classicInnerAspectAngle - baseGeometry.classic.inner.aspectAngle,
    positionAngle:
      tokens.classicInnerPositionAngle - baseGeometry.classic.inner.positionAngle,
    positionHouses:
      tokens.classicInnerPositionHouses - baseGeometry.classic.inner.positionHouses,
  };
  const shiftClassicPositionLane = (lane: WheelPositionLane): WheelPositionLane => ({
    position: lane.position + positionDeltas.position,
    aspectAngle: lane.aspectAngle + positionDeltas.aspectAngle,
    positionAngle: lane.positionAngle + positionDeltas.positionAngle,
    positionHouses: lane.positionHouses + positionDeltas.positionHouses,
  });
  const geometry: WheelGeometryProfiles = {
    classic: {
      ...baseGeometry.classic,
      degreeTickLength: tokens.classicDegreeTickLength,
      signSectorLength: tokens.classicSignSectorLength,
      planetSectorLength: tokens.classicPlanetSectorLength,
      termSectorLength: tokens.classicTermSectorLength,
      decanSectorLength: tokens.classicDecanSectorLength,
      planetLineLength: tokens.classicPlanetLineLength,
      retrogradeOffset: tokens.classicRetrogradeOffset,
      arrowLength: tokens.classicArrowLength,
      houseSectorLength: tokens.classicHouseSectorLength,
      outer: {
        zodiac: tokens.classicOuterZodiac,
        line: tokens.classicOuterLine,
        projectedLabel: tokens.classicOuterProjectedLabel,
        projectedLine: tokens.classicOuterProjectedLine,
      },
      inner: {
        position: tokens.classicInnerPosition,
        aspectAngle: tokens.classicInnerAspectAngle,
        positionAngle: tokens.classicInnerPositionAngle,
        positionHouses: tokens.classicInnerPositionHouses,
        base: tokens.classicInnerBase,
        houseName: tokens.classicInnerHouseName,
      },
      singlePositionLanes: [
        shiftClassicPositionLane(baseGeometry.classic.singlePositionLanes[0]),
        shiftClassicPositionLane(baseGeometry.classic.singlePositionLanes[1]),
        shiftClassicPositionLane(baseGeometry.classic.singlePositionLanes[2]),
      ],
      comparisonPositionLanes: [
        shiftClassicPositionLane(baseGeometry.classic.comparisonPositionLanes[0]),
        shiftClassicPositionLane(baseGeometry.classic.comparisonPositionLanes[1]),
        shiftClassicPositionLane(baseGeometry.classic.comparisonPositionLanes[2]),
      ],
    },
    compact: {
      ...baseGeometry.compact,
      positionLaneSingle: [
        tokens.compactSinglePositionLane0,
        tokens.compactSinglePositionLane1,
        tokens.compactSinglePositionLane2,
      ],
      positionLaneComparison: [
        tokens.compactComparisonPositionLane0,
        tokens.compactComparisonPositionLane1,
        tokens.compactComparisonPositionLane2,
      ],
      positionInset: tokens.compactPositionInset,
      positionMinuteInsetSingle: tokens.compactPositionMinuteInsetSingle,
      positionMinuteInsetWithOuter: tokens.compactPositionMinuteInsetWithOuter,
      positionMinuteInsetComparison: tokens.compactPositionMinuteInsetComparison,
      retrogradeInset: tokens.compactRetrogradeInset,
      base: tokens.compactBase,
      houseSector: tokens.compactHouseSector,
      houseName: tokens.compactHouseName,
    },
    anglo: {
      ...baseGeometry.anglo,
      zodiacSingle: tokens.angloZodiacSingle,
      zodiacWithOuter: tokens.angloZodiacWithOuter,
      zodiacComparisonWithHouses: tokens.angloZodiacComparisonWithHouses,
      subdivisionSector: tokens.angloSubdivisionSector,
      signInnerScale: tokens.angloSignInnerScale,
      rulerBaseScale: tokens.angloRulerBaseScale,
      rulerSubdivisionScale: tokens.angloRulerSubdivisionScale,
      cuspLabelScale: tokens.angloCuspLabelScale,
      innerScale: tokens.angloInnerScale,
      planetScale: tokens.angloPlanetScale,
      aspectScale: tokens.angloAspectScale,
      houseScale: tokens.angloHouseScale,
      leaderInsetScale: tokens.angloLeaderInsetScale,
      aspectLeaderInsetScale: tokens.angloAspectLeaderInsetScale,
      positionInsetScale: tokens.angloPositionInsetScale,
      anglePositionScale: tokens.angloAnglePositionScale,
      arrowInset: tokens.angloArrowInset,
      arrowMaximum: tokens.angloArrowMaximum,
    },
    biwheel: {
      outerMax: tokens.biwheelOuterMax,
      outerHouseSector: tokens.biwheelOuterHouseSector,
      zodiacInset: tokens.biwheelZodiacInset,
      outerPlanetSector: tokens.biwheelOuterPlanetSector,
      outerAngle: tokens.biwheelOuterAngle,
      arrowLength: tokens.biwheelArrowLength,
      outerLineOffset: tokens.biwheelOuterLineOffset,
      projectedLabel: tokens.biwheelProjectedLabel,
      retrogradeOffset: tokens.biwheelRetrogradeOffset,
      outerMinimum: tokens.biwheelOuterMinimum,
    },
  };
  const baseTypography = DEFAULT_WHEEL_RENDER_STYLE.typography.ratios;
  const baseStrokes = DEFAULT_WHEEL_RENDER_STYLE.strokes;
  const baseLabels = DEFAULT_WHEEL_RENDER_STYLE.labels;
  const baseAspects = baseStrokes.aspects;
  const typographyRatios: WheelTypographyRatios = {
    ...baseTypography,
    body: tokens.bodyScale,
    outer: {
      classic: tokens.classicOuterScale,
      compact: tokens.compactOuterScale,
      anglo: tokens.angloOuterScale,
    },
    sign: {
      classic: tokens.classicSignScale,
      compact: tokens.compactSignScale,
      anglo: tokens.angloSignScale,
    },
    subdivision: {
      classic: tokens.classicSubdivisionScale,
      compact: tokens.compactSubdivisionScale,
      anglo: tokens.angloSubdivisionScale,
    },
    termGlyphScale: tokens.termGlyphScale,
    decanGlyphScale: tokens.decanGlyphScale,
    angleLabelScale: tokens.angleLabelScale,
    angleLabelWeight: tokens.angleLabelWeight,
    syzygyScale: tokens.syzygyScale,
    houseLabelScale: tokens.houseLabelScale,
    bodyPosition: {
      degreeScale: tokens.bodyPositionDegreeScale,
      signScale: tokens.bodyPositionSignScale,
      minuteScale: tokens.bodyPositionMinuteScale,
    },
    anglePosition: {
      degreeScale: tokens.anglePositionDegreeScale,
      signScale: tokens.anglePositionSignScale,
      minuteScale: tokens.anglePositionMinuteScale,
    },
    housePosition: {
      degreeScale: tokens.housePositionDegreeScale,
      signScale: tokens.housePositionSignScale,
      minuteScale: tokens.housePositionMinuteScale,
    },
    aspectGlyphScale: tokens.aspectGlyphScale,
    aspectGlyphOffsetScale: tokens.aspectGlyphOffsetScale,
    motionScale: tokens.motionScale,
    outerLabelScale: tokens.outerLabelScale,
    outerProjectedGlyphScale: tokens.outerProjectedGlyphScale,
    angloBodyPosition: {
      ...baseTypography.angloBodyPosition,
      degreeScale: tokens.angloBodyDegreeScale,
      signScale: tokens.bodyPositionSignScale,
      minuteScale: tokens.angloBodyMinuteScale,
    },
    angloAnglePosition: {
      degreeScale: tokens.angloAnglePositionDegreeScale,
      signScale: tokens.anglePositionSignScale,
      minuteScale: tokens.angloAnglePositionMinuteScale,
      gapScale: tokens.angloAnglePositionGapScale,
    },
    angloHousePosition: {
      degreeScale: tokens.angloHousePositionDegreeScale,
      signScale: tokens.housePositionSignScale,
      minuteScale: tokens.angloHousePositionMinuteScale,
      gapScale: tokens.angloHousePositionGapScale,
    },
  };
  const strokes: WheelStrokeStyle = {
    ...baseStrokes,
    mediumBase: tokens.mediumStrokeBase,
    hairline: tokens.hairlineStroke,
    angloStructural: tokens.angloStructuralStroke,
    degreeTick: {
      ...baseStrokes.degreeTick,
      small: tokens.degreeTickStrokeSmall,
      large: tokens.degreeTickStrokeLarge,
    },
    ascMcDefaultBase: tokens.ascMcStrokeBase,
    chartRing: {
      fallbackBase: tokens.chartRingStrokeFallback,
      minBase: tokens.chartRingStrokeMin,
      maxBase: tokens.chartRingStrokeMax,
    },
    aspects: {
      ...baseAspects,
      classicWidth: tokens.aspectClassicWidth,
      angloWidth: tokens.aspectAngloWidth,
      classicDash: [tokens.aspectClassicDashOn, tokens.aspectClassicDashOff],
      angloDash: [tokens.aspectAngloDashOn, tokens.aspectAngloDashOff],
      classicThicknessMin: tokens.aspectClassicThicknessMin,
      classicThicknessMax: tokens.aspectClassicThicknessMax,
      classicThicknessNoOrb: tokens.aspectClassicThicknessDefault,
      angloThicknessMin: tokens.aspectAngloThicknessMin,
      angloThicknessSpan:
        tokens.aspectAngloThicknessMax - tokens.aspectAngloThicknessMin,
      angloThicknessNoOrb: tokens.aspectAngloThicknessDefault,
    },
  };
  const labels: WheelLabelStyle = {
    ...baseLabels,
    houseClassicOffsetScale: tokens.houseClassicOffsetScale,
    houseSecondOffsetScale: tokens.houseSecondOffsetScale,
    outerRadiusOffsetScale: tokens.outerRadiusOffsetScale,
    outerOutsidePadScale: tokens.outerOutsidePadScale,
    outerMotionRadiusScale: tokens.outerMotionRadiusScale,
    outerMotionOffsetScale: tokens.outerMotionOffsetScale,
    motionGapMin: tokens.motionGapMin,
    motionGapScale: tokens.motionGapScale,
    motionRadialNudgeScale: tokens.motionRadialNudgeScale,
    motionTangentNudgeScale: tokens.motionTangentNudgeScale,
    surveil: {
      ...baseLabels.surveil,
      tickLengthMin: tokens.surveilTickLengthMin,
      tickLengthScale: tokens.surveilTickLengthScale,
      glyphGapMin: tokens.surveilGlyphGapMin,
      glyphGapScale: tokens.surveilGlyphGapScale,
      glyphSizeMin: tokens.surveilGlyphSizeMin,
      glyphSizeScale: tokens.surveilGlyphSizeScale,
      labelGapMin: tokens.surveilLabelGapMin,
      labelGapScale: tokens.surveilLabelGapScale,
    },
  };

  return createWheelRenderStyle({
    palette,
    elementColors,
    revision,
    fontUi,
    fontSymbols,
    fontBodySymbols,
    fontSignSymbols,
    fontTermSymbols,
    fontDecanSymbols,
    fontAspectSymbols,
    geometry,
    ringRadiusOverrides: ringRadiusOverridesFromTokens(tokens),
    authoringOverrides,
    authoringTargetRadius,
    authoringTargetProfile,
    typographyRatios,
    strokes,
    linePaint: linePaintFromTokens(tokens),
    labels,
    overlays: {
      compactBreakpoint: tokens.overlayCompactBreakpoint,
      infoFontMin: tokens.overlayInfoFontMin,
      infoFontScale: tokens.overlayInfoFontScale,
      compactInfoFontMin: tokens.overlayCompactInfoFontMin,
      compactInfoFontScale: tokens.overlayCompactInfoFontScale,
      iconMin: tokens.overlayIconMin,
      iconScale: tokens.overlayIconScale,
      compactIconMin: tokens.overlayCompactIconMin,
      compactIconScale: tokens.overlayCompactIconScale,
      labelMin: tokens.overlayLabelMin,
      labelScale: tokens.overlayLabelScale,
      compactLabelMin: tokens.overlayCompactLabelMin,
      compactLabelScale: tokens.overlayCompactLabelScale,
      fontBoxScale: tokens.overlayFontBoxScale,
      rowHeightFactor: tokens.overlayRowHeightFactor,
      gapAfterDayHourScale: tokens.overlayGapAfterDayHourScale,
      groupGapScale: tokens.overlayGroupGapScale,
      columnGapMin: tokens.overlayColumnGapMin,
      columnGapScale: tokens.overlayColumnGapScale,
      edgeInsetScale: tokens.overlayEdgeInsetScale,
      compactEdgeInsetMin: tokens.overlayCompactEdgeInsetMin,
      titlebarSafeTop: tokens.overlayTitlebarSafeTop,
      infoGap: tokens.overlayInfoGap,
      cornerLineHeight: tokens.overlayCornerLineHeight,
      glyphLineHeight: tokens.overlayGlyphLineHeight,
      maxWidthViewportScale: tokens.overlayMaxWidthViewportScale,
    },
    outerLabels: { edgePadFactor: tokens.outerLabelEdgePadFactor },
  });
}

/** Resolve a complete immutable wheel style directly from ThemeState tokens. */
export function resolveWheelRenderStyleFromTokens(
  readValue: WheelCssValueReader = () => "",
  input: Omit<TokenizedWheelRenderStyleInput, "tokens"> = {},
): WheelRenderStyle {
  const palette = input.palette ?? DEFAULT_PALETTE;
  return createTokenizedWheelRenderStyle({
    ...input,
    palette,
    elementColors: input.elementColors ?? resolveWheelElementColors(readValue, palette),
    tokens: resolveWheelRenderTokens(readValue),
  });
}

export function resolveWheelRenderStyle(source: WheelRenderStyleSource): WheelRenderStyle {
  if (source.renderStyle) return source.renderStyle;
  return createWheelRenderStyle({
    palette: source.palette,
    revision: source.styleRevision,
    fontUi: source.fontUi,
    fontSymbols: source.fontSymbols,
  });
}

export function resolveWheelTypographyMetrics(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  maxRadius: number,
): ResolvedWheelTypographyMetrics {
  const ratios = style.typography.ratios;
  // Division by the ratio's denominator preserves the exact floating-point
  // path used by the established renderer (`maxRadius / 16`, `/ 20`, etc.).
  const scaled = (ratio: number) => maxRadius / (1 / ratio);
  const layoutUnit = scaled(PROFILE_BODY);
  const outerLayoutUnit = scaled(PROFILE_OUTER[profile]);
  const bodyPosition = ratios.bodyPosition;
  const anglePosition = ratios.anglePosition;
  const housePosition = ratios.housePosition;
  const angloBodyPosition = ratios.angloBodyPosition;
  const angloAnglePosition = ratios.angloAnglePosition;
  const angloHousePosition = ratios.angloHousePosition;
  const direct = (
    classId: WheelAuthoringTypographyClass,
    fallback: number,
  ) => resolveWheelAuthoringTypographyPx(style, profile, classId, maxRadius, fallback);
  const subdivisionSize = scaled(ratios.subdivision[profile]);
  const outerLabelSize = outerLayoutUnit * ratios.outerLabelScale;
  const outerProjectedGlyphSize =
    outerLayoutUnit * ratios.outerProjectedGlyphScale;
  const outerMotionSize =
    outerLayoutUnit * ratios.motionScale * PROFILE_MOTION_SCALE[profile];
  const secondaryRing = Object.freeze({
    "secondaryRing.fixedStar.label": direct(
      "secondaryRing.fixedStar.label",
      outerLabelSize,
    ),
    "secondaryRing.asteroid.label": direct(
      "secondaryRing.asteroid.label",
      outerLabelSize,
    ),
    "secondaryRing.midpoint.glyph": direct(
      "secondaryRing.midpoint.glyph",
      outerLabelSize,
    ),
    "secondaryRing.midpoint.text": direct(
      "secondaryRing.midpoint.text",
      outerLabelSize,
    ),
    "secondaryRing.hybridHit.label": direct(
      "secondaryRing.hybridHit.label",
      outerLabelSize,
    ),
    "secondaryRing.antiscia.glyph": direct(
      "secondaryRing.antiscia.glyph",
      outerProjectedGlyphSize,
    ),
    "secondaryRing.antiscia.text": direct(
      "secondaryRing.antiscia.text",
      outerProjectedGlyphSize,
    ),
    "secondaryRing.contraAntiscia.glyph": direct(
      "secondaryRing.contraAntiscia.glyph",
      outerProjectedGlyphSize,
    ),
    "secondaryRing.contraAntiscia.text": direct(
      "secondaryRing.contraAntiscia.text",
      outerProjectedGlyphSize,
    ),
    "secondaryRing.dodecatemoria.glyph": direct(
      "secondaryRing.dodecatemoria.glyph",
      outerProjectedGlyphSize,
    ),
    "secondaryRing.dodecatemoria.text": direct(
      "secondaryRing.dodecatemoria.text",
      outerProjectedGlyphSize,
    ),
    "secondaryRing.arabicPart.label": direct(
      "secondaryRing.arabicPart.label",
      outerLabelSize,
    ),
    "secondaryRing.parallelTransit.glyph": direct(
      "secondaryRing.parallelTransit.glyph",
      outerProjectedGlyphSize,
    ),
    "secondaryRing.parallelTransit.motion": direct(
      "secondaryRing.parallelTransit.motion",
      outerMotionSize,
    ),
  } satisfies Partial<Record<WheelAuthoringTypographyClass, number>>);
  return Object.freeze({
    layoutUnit,
    outerLayoutUnit,
    bodySize: direct("bodies.inner.glyph", scaled(ratios.body)),
    outerSize: direct("bodies.outer.glyph", scaled(ratios.outer[profile])),
    signSize: direct("zodiac.signGlyph", scaled(ratios.sign[profile])),
    subdivisionSize,
    termSize: direct("subdivisions.term.glyph", subdivisionSize * ratios.termGlyphScale),
    decanSize: direct("subdivisions.decan.glyph", subdivisionSize * ratios.decanGlyphScale),
    angleLabelScale: ratios.angleLabelScale,
    angleLabelSize: direct("angles.inner.label", layoutUnit * ratios.angleLabelScale),
    outerAngleLabelSize: direct(
      "angles.outer.label",
      outerLayoutUnit * ratios.angleLabelScale,
    ),
    angleLabelWeight: ratios.angleLabelWeight,
    syzygyScale: ratios.syzygyScale,
    houseLabelSize: direct("houses.inner.label", layoutUnit * ratios.houseLabelScale),
    outerHouseLabelSize: direct(
      "houses.outer.label",
      outerLayoutUnit * ratios.houseLabelScale,
    ),
    bodyPosition: Object.freeze({
      degreeSize: direct(
        "bodies.inner.position.degree",
        layoutUnit * bodyPosition.degreeScale,
      ),
      signSize: direct(
        "bodies.inner.position.sign",
        layoutUnit * bodyPosition.signScale,
      ),
      minuteSize: direct(
        "bodies.inner.position.minute",
        layoutUnit * bodyPosition.minuteScale,
      ),
    }),
    anglePosition: Object.freeze({
      degreeSize: direct(
        "angles.inner.position.degree",
        layoutUnit * anglePosition.degreeScale,
      ),
      signSize: direct(
        "angles.inner.position.sign",
        layoutUnit * anglePosition.signScale,
      ),
      minuteSize: direct(
        "angles.inner.position.minute",
        layoutUnit * anglePosition.minuteScale,
      ),
    }),
    housePosition: Object.freeze({
      degreeSize: direct(
        "houses.inner.position.degree",
        layoutUnit * housePosition.degreeScale,
      ),
      signSize: direct(
        "houses.inner.position.sign",
        layoutUnit * housePosition.signScale,
      ),
      minuteSize: direct(
        "houses.inner.position.minute",
        layoutUnit * housePosition.minuteScale,
      ),
    }),
    angloBodyPosition: Object.freeze({
      degreeSize: direct(
        "bodies.inner.position.degree",
        layoutUnit * angloBodyPosition.degreeScale,
      ),
      signSize: direct(
        "bodies.inner.position.sign",
        layoutUnit * angloBodyPosition.signScale,
      ),
      minuteSize: direct(
        "bodies.inner.position.minute",
        layoutUnit * angloBodyPosition.minuteScale,
      ),
    }),
    angloAnglePosition: Object.freeze({
      degreeSize: direct(
        "angles.inner.position.degree",
        layoutUnit * angloAnglePosition.degreeScale,
      ),
      signSize: direct(
        "angles.inner.position.sign",
        layoutUnit * angloAnglePosition.signScale,
      ),
      minuteSize: direct(
        "angles.inner.position.minute",
        layoutUnit * angloAnglePosition.minuteScale,
      ),
      gap: layoutUnit * angloAnglePosition.gapScale,
    }),
    angloHousePosition: Object.freeze({
      degreeSize: direct(
        "houses.inner.position.degree",
        layoutUnit * angloHousePosition.degreeScale,
      ),
      signSize: direct(
        "houses.inner.position.sign",
        layoutUnit * angloHousePosition.signScale,
      ),
      minuteSize: direct(
        "houses.inner.position.minute",
        layoutUnit * angloHousePosition.minuteScale,
      ),
      gap: layoutUnit * angloHousePosition.gapScale,
    }),
    aspectGlyphSize: direct("aspects.primary.glyph", layoutUnit * ratios.aspectGlyphScale),
    interchartAspectGlyphSize: direct(
      "aspects.interchart.glyph",
      layoutUnit * ratios.aspectGlyphScale,
    ),
    aspectGlyphOffset: layoutUnit * ratios.aspectGlyphOffsetScale,
    motionSize: direct(
      "bodies.inner.motion",
      layoutUnit * ratios.motionScale * PROFILE_MOTION_SCALE[profile],
    ),
    outerMotionSize: direct("bodies.outer.motion", outerMotionSize),
    outerLabelSize,
    outerProjectedGlyphSize,
    secondaryRing,
  });
}

/** Resolve one class-level font size, retaining the legacy metric as fallback. */
export function resolveWheelAuthoringTypographyPx(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringTypographyClass,
  maxRadius: number,
  fallback: number,
): number {
  const sourcePx =
    style.authoringOverrides.typography[profile]?.[classId]?.fontSizePx;
  if (sourcePx === undefined || !Number.isFinite(sourcePx)) return fallback;
  // Profile validation owns the tighter class-specific 96/128 px bounds. This
  // final renderer guard prevents malformed external source from exploding a
  // Canvas allocation before validation can report it.
  const safeSourcePx = Math.min(256, Math.max(0.25, sourcePx));
  return resolveWheelAuthoringPx(style, safeSourcePx, maxRadius);
}

/**
 * Resolve every profile-v2 text property for one semantic class. Callers pass
 * the occurrence palette/font fallback so sparse class overrides preserve the
 * exact production appearance.
 */
export function resolveWheelTypographyPaint(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringTypographyClass,
  maxRadius: number,
  defaults: Readonly<{
    font: string;
    size: number;
    color: string;
    weight?: number;
    style?: string;
    tracking?: number;
    opacity?: number;
  }>,
): ResolvedWheelTypographyPaint {
  const direct = style.authoringOverrides.typography[profile]?.[classId];
  const sourceTracking = direct?.trackingPx;
  const sourceOpacity = direct?.opacity;
  const sourceWeight = direct?.fontRef?.weight;
  return Object.freeze({
    font: direct?.fontRef?.cssFamily?.trim() || defaults.font,
    size: resolveWheelAuthoringTypographyPx(
      style,
      profile,
      classId,
      maxRadius,
      defaults.size,
    ),
    weight:
      sourceWeight !== undefined && Number.isFinite(sourceWeight)
        ? Math.min(1000, Math.max(1, sourceWeight))
        : defaults.weight ?? 400,
    style: direct?.fontRef?.style?.trim() || defaults.style || "normal",
    tracking:
      sourceTracking !== undefined && Number.isFinite(sourceTracking)
        ? resolveWheelAuthoringPx(
            style,
            Math.min(64, Math.max(-32, sourceTracking)),
            maxRadius,
          )
        : defaults.tracking ?? 0,
    color: direct?.color?.trim() || defaults.color,
    opacity:
      sourceOpacity !== undefined && Number.isFinite(sourceOpacity)
        ? Math.min(1, Math.max(0, sourceOpacity))
        : Math.min(1, Math.max(0, defaults.opacity ?? 1)),
  });
}

export function resolveScaledWheelStroke(
  style: WheelRenderStyle,
  chartSize: number,
  requestedBase: number,
): number {
  return Math.max(
    1,
    Math.round((requestedBase * chartSize) / style.strokes.referenceSize),
  );
}

export function resolveWheelStrokeMetrics(
  style: WheelRenderStyle,
  chartSize: number,
  ascMcBase = style.strokes.ascMcDefaultBase,
): ResolvedWheelStrokeMetrics {
  const degreeTick = style.strokes.degreeTick;
  return Object.freeze({
    medium: resolveScaledWheelStroke(style, chartSize, style.strokes.mediumBase),
    degreeTick:
      chartSize <= degreeTick.breakpoint ? degreeTick.small : degreeTick.large,
    ascMc: resolveScaledWheelStroke(style, chartSize, ascMcBase),
  });
}

const DEFAULT_AUTHORING_LINE_CLASS: Readonly<
  Partial<Record<WheelLinePaintRole, WheelAuthoringLineClass>>
> = Object.freeze({
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
  zodiacSpoke: "zodiac.spoke",
  termBoundary: "subdivisions.term.boundary",
  decanBoundary: "subdivisions.decan.boundary",
  houseCusp: "houses.inner.cusp",
  angle: "angles.inner.ray",
  bodyLeader: "bodies.inner.leader",
  aspect: "aspects.primary.line",
});

/**
 * Resolve one semantic line class. Legacy roles provide untouched fallbacks;
 * profile-v2 values are final px, patterns, and opacity for the exact class.
 */
export function resolveWheelLinePaint(
  style: WheelRenderStyle,
  role: WheelLinePaintRole,
  baseWidth: number,
  defaults: Readonly<{
    dash?: readonly number[];
    color?: string;
    opacity?: number;
    lineCap?: CanvasLineCap;
    lineJoin?: CanvasLineJoin;
  }> = {},
  authoringClass = DEFAULT_AUTHORING_LINE_CLASS[role],
): ResolvedWheelLinePaint {
  const paint = style.linePaint[role];
  const direct = authoringClass == null
    ? undefined
    : style.authoringOverrides.linePaint[style.authoringTargetProfile]?.[authoringClass];
  const directPattern = direct?.strokeStyle;
  const pattern = directPattern == null || directPattern === "renderer"
    ? paint.pattern
    : directPattern === "solid"
      ? 1
      : directPattern === "dashed"
        ? 2
        : 3;
  let dash = defaults.dash ? [...defaults.dash] : undefined;
  let lineCap = direct?.lineCap ?? defaults.lineCap;
  if (pattern === 1) {
    dash = undefined;
  } else if (pattern === 2) {
    dash = [
      direct?.dashOnPx === undefined
        ? paint.dashOn
        : resolveWheelAuthoringPx(style, Math.min(96, Math.max(0, direct.dashOnPx))),
      direct?.dashOffPx === undefined
        ? paint.dashOff
        : resolveWheelAuthoringPx(style, Math.min(96, Math.max(0, direct.dashOffPx))),
    ];
  } else if (pattern === 3) {
    dash = [
      0,
      direct?.dashOffPx === undefined
        ? paint.dashOff
        : resolveWheelAuthoringPx(style, Math.min(96, Math.max(0, direct.dashOffPx))),
    ];
    lineCap = "round";
  }
  const directOpacity = direct?.opacity;
  const opacityScale = directOpacity !== undefined && Number.isFinite(directOpacity)
    ? Math.min(1, Math.max(0, directOpacity))
    : paint.opacity;
  const width = direct?.strokeWidthPx !== undefined
    && Number.isFinite(direct.strokeWidthPx)
    ? resolveWheelAuthoringPx(
        style,
        Math.min(16, Math.max(0, direct.strokeWidthPx)),
      )
    : baseWidth * paint.widthScale;
  return Object.freeze({
    width,
    dash,
    ...((direct?.color?.trim() || defaults.color?.trim())
      ? {
          fill: direct?.color?.trim() || defaults.color?.trim(),
          outline: direct?.color?.trim() || defaults.color?.trim(),
        }
      : {}),
    opacity: Math.min(1, Math.max(0, (defaults.opacity ?? 1) * opacityScale)),
    lineCap,
    lineJoin: direct?.lineJoin ?? defaults.lineJoin,
  });
}
