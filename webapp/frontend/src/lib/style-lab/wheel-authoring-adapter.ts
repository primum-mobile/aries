// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DEFAULT_WHEEL_AUTHORING_OVERRIDES,
  WHEEL_AUTHORING_LINE_CLASSES,
  WHEEL_AUTHORING_TYPOGRAPHY_CLASSES,
  projectWheelAuthoringStyle,
  resolveWheelAuthoringTypographyPx,
  resolveWheelLinePaint,
  resolveWheelPaintedRingRadius,
  resolveScaledWheelStroke,
  resolveWheelStrokeMetrics,
  resolveWheelTypographyMetrics,
  type ResolvedWheelLinePaint,
  type WheelAuthoringLineClass,
  type WheelAuthoringLinePaintOverride,
  type WheelAuthoringOverrides,
  type WheelAuthoringStrokeStyle,
  type WheelAuthoringTypographyClass,
  type WheelGeometryInput,
  type WheelLinePaintRole,
  type WheelPaintedRingRole,
  type WheelRenderStyle,
  type WheelTypographyProfile,
} from "../chart/wheel-render-style";
import {
  CHART_STYLE_CLASS_MANIFEST_VERSION,
  CHART_STYLE_PROFILE_SCHEMA_VERSION,
  chartPx,
  resolveVariantClassStyle,
  type ChartStyleClassMap,
  type ChartStyleClassProperties,
  type ChartStyleProfileV2,
} from "./authoring-schema";
import {
  CHART_AUTHORING_REFERENCE_SPACE,
  opacityToEditorPercent,
  unprojectChartPx,
} from "./unit-projection";

export const WHEEL_AUTHORING_OVERRIDE_PREFIX = "authoring.wheel." as const;

export type WheelAuthoringEditScope = "base" | WheelTypographyProfile;

export type WheelAuthoringFlatProperty =
  | "fontSize"
  | "strokeWidth"
  | "strokeStyle"
  | "dashLength"
  | "dashGap"
  | "opacity"
  | "lineCap"
  | "lineJoin"
  | "radius";

export function wheelAuthoringOverrideId(
  profile: WheelAuthoringEditScope,
  classId: string,
  property: WheelAuthoringFlatProperty,
): string {
  return `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${profile}.${classId}.${property}`;
}

const FLAT_PROPERTY_NAMES: readonly WheelAuthoringFlatProperty[] = [
  "fontSize",
  "strokeWidth",
  "strokeStyle",
  "dashLength",
  "dashGap",
  "opacity",
  "lineCap",
  "lineJoin",
  "radius",
];

/**
 * Compile the editor's flat, undo-friendly conventional values. These keys are
 * deliberately separate from legacy CSS-token overrides and never leak raw
 * ratios or width multipliers into the inspector.
 */
export function compileFlatWheelAuthoringOverrides(
  overrides: Readonly<Record<string, unknown>>,
): WheelAuthoringOverrides {
  return compileWheelAuthoringOverrides(
    createChartStyleProfileV2FromFlatOverrides(overrides),
  );
}

function flatWheelAuthoringClassMaps(
  overrides: Readonly<Record<string, unknown>>,
): Record<WheelAuthoringEditScope, Record<string, ChartStyleClassProperties>> {
  const classMaps: Record<WheelAuthoringEditScope, Record<string, ChartStyleClassProperties>> = {
    base: {},
    classic: {},
    compact: {},
    anglo: {},
  };
  for (const [semanticId, rawValue] of Object.entries(overrides)) {
    if (!semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX)) continue;
    const remainder = semanticId.slice(WHEEL_AUTHORING_OVERRIDE_PREFIX.length);
    const profileSeparator = remainder.indexOf(".");
    if (profileSeparator < 0) continue;
    const profile = remainder.slice(0, profileSeparator) as WheelAuthoringEditScope;
    if (!(profile in classMaps)) continue;
    const target = remainder.slice(profileSeparator + 1);
    const property = FLAT_PROPERTY_NAMES.find((candidate) => target.endsWith(`.${candidate}`));
    if (!property) continue;
    const classId = target.slice(0, -(property.length + 1));
    if (!classId) continue;
    const current = classMaps[profile][classId] ?? {};
    const numericValue = typeof rawValue === "number" && Number.isFinite(rawValue)
      ? rawValue
      : null;
    let patch: ChartStyleClassProperties = current;
    if (property === "fontSize" && numericValue != null) {
      patch = { ...current, fontSize: chartPx(numericValue) };
    } else if (property === "strokeWidth" && numericValue != null) {
      patch = { ...current, strokeWidth: chartPx(numericValue) };
    } else if (property === "dashLength" && numericValue != null) {
      patch = { ...current, dashLength: chartPx(numericValue) };
    } else if (property === "dashGap" && numericValue != null) {
      patch = { ...current, dashGap: chartPx(numericValue) };
    } else if (property === "radius" && numericValue != null) {
      patch = { ...current, radius: chartPx(numericValue) };
    } else if (property === "opacity" && numericValue != null) {
      patch = { ...current, opacity: Math.min(100, Math.max(0, numericValue)) / 100 };
    } else if (
      property === "strokeStyle"
      && (rawValue === "solid" || rawValue === "dashed" || rawValue === "dotted")
    ) {
      patch = { ...current, strokeStyle: rawValue };
    } else if (
      property === "lineCap"
      && (rawValue === "butt" || rawValue === "round" || rawValue === "square")
    ) {
      patch = { ...current, lineCap: rawValue };
    } else if (
      property === "lineJoin"
      && (rawValue === "bevel" || rawValue === "round" || rawValue === "miter")
    ) {
      patch = { ...current, lineJoin: rawValue };
    }
    classMaps[profile][classId] = Object.freeze(patch);
  }
  return classMaps;
}

export function createChartStyleProfileV2FromFlatOverrides(
  overrides: Readonly<Record<string, unknown>>,
): ChartStyleProfileV2 {
  const variants = flatWheelAuthoringClassMaps(overrides);
  return Object.freeze({
    $schema: "https://aries.app/schemas/chart-style-profile-v2.json",
    profileSchemaVersion: CHART_STYLE_PROFILE_SCHEMA_VERSION,
    classManifestVersion: CHART_STYLE_CLASS_MANIFEST_VERSION,
    base: Object.freeze({ id: "aries-default", contentHash: "runtime-default" }),
    referenceSpace: CHART_AUTHORING_REFERENCE_SPACE,
    styles: Object.freeze(variants.base),
    variants: Object.freeze({
      classic: Object.freeze(variants.classic),
      compact: Object.freeze(variants.compact),
      anglo: Object.freeze(variants.anglo),
    }),
  });
}

const RING_CLASS_TO_ROLE: Readonly<
  Record<string, WheelPaintedRingRole>
> = Object.freeze({
  "rings.outerMaximum": "outerMaximumRing",
  "rings.outerHouse": "outerHouseRing",
  "rings.outerDegree": "outerDegreeRing",
  "rings.zodiacOuter": "zodiacOuterRing",
  "rings.innerDegree": "innerDegreeRing",
  "rings.zodiacInner": "zodiacInnerRing",
  "rings.term": "termRing",
  "rings.angloCuspOuter": "cuspOuterRing",
  "rings.innerBoundary": "innerBoundaryRing",
  "rings.aspectBoundary": "aspectBoundaryRing",
  "rings.houseBoundary": "houseBoundaryRing",
  "rings.base": "baseRing",
});

const LINE_CLASS_TO_LEGACY_ROLE: Readonly<
  Partial<Record<WheelAuthoringLineClass, WheelLinePaintRole>>
> = Object.freeze({
  "rings.outerMaximum": "outerMaximumRing",
  "rings.outerHouse": "outerHouseRing",
  "rings.outerDegree": "outerDegreeRing",
  "rings.zodiacOuter": "zodiacOuterRing",
  "rings.innerDegree": "innerDegreeRing",
  "rings.zodiacInner": "zodiacInnerRing",
  "rings.term": "termRing",
  "rings.angloCuspOuter": "cuspOuterRing",
  "rings.innerBoundary": "innerBoundaryRing",
  "rings.aspectBoundary": "aspectBoundaryRing",
  "rings.houseBoundary": "houseBoundaryRing",
  "rings.base": "baseRing",
  "zodiac.spoke": "zodiacSpoke",
  "zodiac.tick.inner.10deg": "degreeTick",
  "zodiac.tick.inner.5deg": "degreeTick",
  "zodiac.tick.inner.1deg": "degreeTick",
  "zodiac.tick.outer.10deg": "degreeTick",
  "zodiac.tick.outer.5deg": "degreeTick",
  "zodiac.tick.outer.1deg": "degreeTick",
  "zodiac.tick.angloCuspRuler.10deg": "subdivision",
  "zodiac.tick.angloCuspRuler.5deg": "subdivision",
  "zodiac.tick.angloCuspRuler.1deg": "subdivision",
  "zodiac.tick.angloHouseCusp": "houseCusp",
  "zodiac.tick.angloAngleRuler": "angle",
  "subdivisions.term.boundary": "termBoundary",
  "subdivisions.decan.boundary": "decanBoundary",
  "houses.inner.cusp": "houseCusp",
  "houses.outer.cusp": "houseCusp",
  "angles.inner.ray": "angle",
  "angles.inner.arrowhead": "angle",
  "angles.outer.ray": "angle",
  "angles.outer.arrowhead": "angle",
  "bodies.inner.leader": "bodyLeader",
  "bodies.outer.leader": "outerLeader",
  "aspects.primary.line": "aspect",
  "aspects.interchart.line": "aspect",
  "aspects.interchart.endpointMarker": "aspect",
  "secondaryRing.fixedStar.leader": "outerLeader",
  "secondaryRing.asteroid.leader": "outerLeader",
  "secondaryRing.midpoint.leader": "outerLeader",
  "secondaryRing.hybridHit.leader": "outerLeader",
  "secondaryRing.antiscia.leader": "outerLeader",
  "secondaryRing.contraAntiscia.leader": "outerLeader",
  "secondaryRing.dodecatemoria.leader": "outerLeader",
  "secondaryRing.arabicPart.leader": "outerLeader",
  "secondaryRing.parallelTransit.leader": "outerLeader",
  "surveil.tick": "outerLeader",
});

function isLineClass(classId: string): classId is WheelAuthoringLineClass {
  return (WHEEL_AUTHORING_LINE_CLASSES as readonly string[]).includes(classId);
}

function isTypographyClass(
  classId: string,
): classId is WheelAuthoringTypographyClass {
  return (WHEEL_AUTHORING_TYPOGRAPHY_CLASSES as readonly string[]).includes(classId);
}

function lineOverride(
  properties: ChartStyleClassProperties,
): WheelAuthoringLinePaintOverride | undefined {
  if (
    properties.strokeWidth == null
    && properties.strokeStyle == null
    && properties.dashLength == null
    && properties.dashGap == null
    && properties.opacity == null
    && properties.lineCap == null
    && properties.lineJoin == null
  ) return undefined;
  return Object.freeze({
    ...(properties.strokeWidth == null
      ? {} : { strokeWidthPx: properties.strokeWidth.value }),
    ...(properties.strokeStyle == null
      ? {} : { strokeStyle: properties.strokeStyle }),
    ...(properties.dashLength == null
      ? {} : { dashOnPx: properties.dashLength.value }),
    ...(properties.dashGap == null
      ? {} : { dashOffPx: properties.dashGap.value }),
    ...(properties.opacity == null ? {} : { opacity: properties.opacity }),
    ...(properties.lineCap == null ? {} : { lineCap: properties.lineCap }),
    ...(properties.lineJoin == null ? {} : { lineJoin: properties.lineJoin }),
  });
}

export type ResolvedWheelAuthoringClassMaps = Readonly<
  Record<WheelTypographyProfile, ChartStyleClassMap>
>;

/** Compile already-resolved class maps into the paint-only renderer channel. */
export function compileWheelAuthoringClassMaps(
  classMaps: ResolvedWheelAuthoringClassMaps,
  referenceRadius = CHART_AUTHORING_REFERENCE_SPACE.wheelRadius,
): WheelAuthoringOverrides {
  const typography: Record<string, Record<string, number>> = {};
  const linePaint: Record<string, Record<string, WheelAuthoringLinePaintOverride>> = {};
  const ringRadii: Record<string, Record<string, number>> = {};
  for (const profile of ["classic", "compact", "anglo"] as const) {
    const classes = classMaps[profile];
    const profileTypography: Record<string, number> = {};
    const profileLines: Record<string, WheelAuthoringLinePaintOverride> = {};
    const profileRadii: Record<string, number> = {};
    for (const [classId, properties] of Object.entries(classes)) {
      if (isTypographyClass(classId) && properties.fontSize != null) {
        profileTypography[classId] = properties.fontSize.value;
      }
      if (isLineClass(classId)) {
        const directLine = lineOverride(properties);
        if (directLine) profileLines[classId] = directLine;
      }
      const ringRole = RING_CLASS_TO_ROLE[classId];
      if (ringRole && properties.radius != null) {
        profileRadii[ringRole] = properties.radius.value;
      }
    }
    if (Object.keys(profileTypography).length) typography[profile] = profileTypography;
    if (Object.keys(profileLines).length) linePaint[profile] = profileLines;
    if (Object.keys(profileRadii).length) ringRadii[profile] = profileRadii;
  }
  return Object.freeze({
    referenceRadius: Number.isFinite(referenceRadius) && referenceRadius > 0
      ? referenceRadius
      : DEFAULT_WHEEL_AUTHORING_OVERRIDES.referenceRadius,
    typography: Object.freeze(typography),
    linePaint: Object.freeze(linePaint),
    ringRadii: Object.freeze(ringRadii),
  }) as WheelAuthoringOverrides;
}

/** Resolve shared base + sparse variant source, then compile all profiles. */
export function compileWheelAuthoringOverrides(
  profile: Pick<ChartStyleProfileV2, "styles" | "variants" | "referenceSpace">,
): WheelAuthoringOverrides {
  const classIds = new Set<string>(Object.keys(profile.styles));
  for (const variant of ["classic", "compact", "anglo"] as const) {
    for (const classId of Object.keys(profile.variants[variant] ?? {})) classIds.add(classId);
  }
  const classMaps = Object.fromEntries(
    (["classic", "compact", "anglo"] as const).map((variant) => [
      variant,
      Object.fromEntries(
        [...classIds].map((classId) => [
          classId,
          resolveVariantClassStyle(profile, classId, variant),
        ]),
      ),
    ]),
  ) as Record<WheelTypographyProfile, ChartStyleClassMap>;
  return compileWheelAuthoringClassMaps(classMaps, profile.referenceSpace.wheelRadius);
}

export type WheelAuthoringClassDefaults = Readonly<{
  fontSizePx?: number;
  strokeWidthPx?: number;
  strokeStyle?: Exclude<WheelAuthoringStrokeStyle, "renderer">;
  dashOnPx?: number;
  dashOffPx?: number;
  opacityPercent?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  radiusPx?: number;
  diameterPx?: number;
}>;

export type WheelAuthoringClassDefaultContext = Readonly<{
  geometry?: WheelGeometryInput;
  targetWheelRadius?: number;
  baseLineWidthPx?: number;
  lineDefaults?: Readonly<{
    dash?: readonly number[];
    opacity?: number;
    lineCap?: CanvasLineCap;
    lineJoin?: CanvasLineJoin;
  }>;
  runtimeFontSizePx?: number;
}>;

function typographyFallback(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringTypographyClass,
  targetRadius: number,
  explicitFallback?: number,
): number {
  if (explicitFallback != null) return explicitFallback;
  const metrics = resolveWheelTypographyMetrics(style, profile, targetRadius);
  if (classId === "zodiac.signGlyph") return metrics.signSize;
  if (classId === "subdivisions.term.glyph") return metrics.termSize;
  if (classId === "subdivisions.decan.glyph") return metrics.decanSize;
  if (classId === "houses.inner.label") return metrics.houseLabelSize;
  if (classId === "houses.outer.label") return metrics.outerHouseLabelSize;
  if (classId === "angles.inner.label") return metrics.angleLabelSize;
  if (classId === "angles.outer.label") return metrics.outerAngleLabelSize;
  if (classId === "bodies.inner.glyph") return metrics.bodySize;
  if (classId === "bodies.outer.glyph") return metrics.outerSize;
  if (classId === "bodies.inner.motion") return metrics.motionSize;
  if (classId === "bodies.outer.motion") return metrics.outerMotionSize;
  if (classId.endsWith("position.degree")) {
    if (classId.startsWith("houses.")) return profile === "anglo"
      ? metrics.angloHousePosition.degreeSize : metrics.housePosition.degreeSize;
    if (classId.startsWith("angles.")) return profile === "anglo"
      ? metrics.angloAnglePosition.degreeSize : metrics.anglePosition.degreeSize;
    return profile === "anglo"
      ? metrics.angloBodyPosition.degreeSize : metrics.bodyPosition.degreeSize;
  }
  if (classId.endsWith("position.sign")) {
    if (classId.startsWith("houses.")) return metrics.angloHousePosition.signSize;
    if (classId.startsWith("angles.")) return metrics.angloAnglePosition.signSize;
    return metrics.angloBodyPosition.signSize;
  }
  if (classId.endsWith("position.minute")) {
    if (classId.startsWith("houses.")) return profile === "anglo"
      ? metrics.angloHousePosition.minuteSize : metrics.housePosition.minuteSize;
    if (classId.startsWith("angles.")) return profile === "anglo"
      ? metrics.angloAnglePosition.minuteSize : metrics.anglePosition.minuteSize;
    return profile === "anglo"
      ? metrics.angloBodyPosition.minuteSize : metrics.bodyPosition.minuteSize;
  }
  if (classId.startsWith("aspects.")) return metrics.aspectGlyphSize;
  return classId.endsWith(".glyph") || classId.endsWith(".motion")
    ? metrics.outerProjectedGlyphSize
    : metrics.outerLabelSize;
}

function resolvedStrokeStyle(
  paint: ResolvedWheelLinePaint,
): Exclude<WheelAuthoringStrokeStyle, "renderer"> {
  if (!paint.dash?.length) return "solid";
  return paint.dash[0] === 0 && paint.lineCap === "round" ? "dotted" : "dashed";
}

function defaultReferenceLineWidth(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringLineClass,
): number {
  const chartSize = style.authoringOverrides.referenceRadius * 2;
  if (
    classId === "rings.zodiacOuter"
    || classId === "rings.innerBoundary"
    || classId === "zodiac.spoke"
  ) {
    return resolveScaledWheelStroke(
      style,
      chartSize,
      style.strokes.chartRing.fallbackBase,
    );
  }
  if (classId === "rings.base" || classId.startsWith("angles.")) {
    return profile === "anglo"
      ? style.strokes.angloStructural
      : resolveScaledWheelStroke(style, chartSize, style.strokes.ascMcDefaultBase);
  }
  if (classId.endsWith("10deg")) {
    return resolveWheelStrokeMetrics(style, chartSize).degreeTick;
  }
  if (classId.startsWith("bodies.")) {
    return resolveWheelStrokeMetrics(style, chartSize).medium;
  }
  if (classId.startsWith("aspects.")) {
    return profile === "anglo"
      ? style.strokes.aspects.angloWidth
      : style.strokes.aspects.classicWidth;
  }
  if (
    classId.startsWith("zodiac.tick.anglo")
    || classId === "zodiac.tick.angloHouseCusp"
  ) return style.strokes.angloStructural;
  return style.strokes.hairline;
}

/**
 * Read exact conventional values for the compact inspector. When active paint
 * has a state-dependent base width/font size, pass that measured fallback in
 * context; the returned values are always reference-space chart px.
 */
export function readWheelAuthoringClassDefaults(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: string,
  context: WheelAuthoringClassDefaultContext = {},
): WheelAuthoringClassDefaults {
  const referenceRadius = style.authoringOverrides.referenceRadius;
  const targetRadius = context.targetWheelRadius ?? referenceRadius;
  const projection = { wheelRadius: targetRadius, referenceRadius };
  const output: Record<string, number | string | undefined> = {};
  if (isTypographyClass(classId)) {
    const fallback = typographyFallback(
      style,
      profile,
      classId,
      targetRadius,
      context.runtimeFontSizePx,
    );
    const runtime = resolveWheelAuthoringTypographyPx(
      style,
      profile,
      classId,
      targetRadius,
      fallback,
    );
    output.fontSizePx = unprojectChartPx(runtime, projection);
  }
  if (isLineClass(classId)) {
    const role = LINE_CLASS_TO_LEGACY_ROLE[classId];
    if (role) {
      const projected = projectWheelAuthoringStyle(style, referenceRadius, profile);
      const baseWidth = context.baseLineWidthPx == null
        ? defaultReferenceLineWidth(style, profile, classId)
        : unprojectChartPx(context.baseLineWidthPx, projection);
      const paint = resolveWheelLinePaint(
        projected,
        role,
        baseWidth,
        context.lineDefaults,
        classId,
      );
      output.strokeWidthPx = paint.width;
      output.strokeStyle = resolvedStrokeStyle(paint);
      if (paint.dash) {
        output.dashOnPx = paint.dash[0] ?? 0;
        output.dashOffPx = paint.dash[1] ?? 0;
      }
      output.opacityPercent = opacityToEditorPercent(paint.opacity);
      output.lineCap = paint.lineCap;
      output.lineJoin = paint.lineJoin;
    }
  }
  const ringRole = RING_CLASS_TO_ROLE[classId];
  if (ringRole && context.geometry) {
    const runtimeRadius = resolveWheelPaintedRingRadius(style, context.geometry, ringRole);
    const radiusPx = unprojectChartPx(runtimeRadius, {
      wheelRadius: context.geometry.maxRadius,
      referenceRadius,
    });
    output.radiusPx = radiusPx;
    output.diameterPx = radiusPx * 2;
  }
  return Object.freeze(output) as WheelAuthoringClassDefaults;
}
