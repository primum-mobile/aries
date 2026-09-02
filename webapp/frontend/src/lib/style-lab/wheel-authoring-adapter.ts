// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DEFAULT_WHEEL_AUTHORING_OVERRIDES,
  WHEEL_AUTHORING_FILL_CLASSES,
  WHEEL_AUTHORING_LINE_CLASSES,
  WHEEL_AUTHORING_TYPOGRAPHY_CLASSES,
  WHEEL_BAND_SPANS,
  WHEEL_BAND_SPAN_SCALE_RANGE,
  WHEEL_RULER_DEPTH_RANGE,
  WHEEL_RULER_IDS,
  WHEEL_SCALE_RANGE,
  WHEEL_TICK_LENGTH_RANGE,
  projectWheelAuthoringStyle,
  resolveWheelTypographyPaint,
  resolveWheelFillPaint,
  resolveWheelLinePaint,
  resolveWheelBandSpanFields,
  resolveWheelBandSpanScale,
  resolveWheelPaintedRingRadius,
  resolveCanonicalWheelRingSet,
  resolveWheelRingSet,
  resolveWheelTickLength,
  resolveScaledWheelStroke,
  resolveWheelStrokeMetrics,
  resolveWheelTypographyMetrics,
  type ResolvedWheelLinePaint,
  type WheelAuthoringFillClass,
  type WheelAuthoringFillPaintOverride,
  type WheelAuthoringFillPattern,
  type WheelAuthoringFontRef,
  type WheelAuthoringLineClass,
  type WheelAuthoringLinePaintOverride,
  type WheelAuthoringOverrides,
  type WheelAuthoringStrokeStyle,
  type WheelAuthoringTypographyClass,
  type WheelAuthoringTypographyOverride,
  type WheelGeometryInput,
  type WheelLinePaintRole,
  type WheelPaintedRingRole,
  type WheelRenderStyle,
  type WheelRulerId,
  type WheelTypographyProfile,
} from "../chart/wheel-render-style";
import {
  CHART_STYLE_CLASS_MANIFEST_VERSION,
  CHART_STYLE_PROFILE_SCHEMA_VERSION,
  chartPx,
  resolveVariantClassStyle,
  type ChartStyleClassMap,
  type ChartStyleClassProperties,
  type ChartStyleColor,
  type ChartStyleFontRef,
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
  | "fontRef"
  | "fontSize"
  | "tracking"
  | "color"
  | "strokeWidth"
  | "strokeStyle"
  | "dashLength"
  | "dashGap"
  | "fillPattern"
  | "shadowPattern"
  | "cellSize"
  | "dotSize"
  | "backgroundColor"
  | "patternColor"
  | "gradientType"
  | "gradientDirection"
  | "gradientStartColor"
  | "gradientEndColor"
  | "gradientAngle"
  | "textureMask"
  | "maskDirection"
  | "maskAngle"
  | "maskAmount"
  | "shadowColor"
  | "shadowX"
  | "shadowY"
  | "shadowBlur"
  | "density"
  | "angle"
  | "seed"
  | "opacity"
  | "lineCap"
  | "lineJoin"
  | "radius"
  | "scale"
  | "spanInner"
  | "spanScale"
  | "rulerDepth"
  | "tickLength";

export function wheelAuthoringOverrideId(
  profile: WheelAuthoringEditScope,
  classId: string,
  property: WheelAuthoringFlatProperty,
): string {
  return `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${profile}.${classId}.${property}`;
}

/**
 * The class an authoring override addresses, or null when the id is not one.
 *
 * The inverse of `wheelAuthoringOverrideId`, for the cases that must go from a
 * write back to the thing written to — telling a family's members apart, for
 * one. The scope and property segments never contain a dot, so the class id is
 * everything between them however deep its own path runs.
 */
export function wheelAuthoringOverrideClassId(semanticId: string): string | null {
  if (!semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX)) return null;
  const body = semanticId.slice(WHEEL_AUTHORING_OVERRIDE_PREFIX.length);
  const scopeCut = body.indexOf(".");
  const propertyCut = body.lastIndexOf(".");
  if (scopeCut <= 0 || propertyCut <= scopeCut) return null;
  return body.slice(scopeCut + 1, propertyCut);
}

/**
 * The authoring ids one wheel variant holds in its own right.
 *
 * Base is folded into all three profiles before anything paints, so compiled
 * overrides cannot tell a shared default from a variant's own value. The
 * authored map still can, and two callers need the distinction: a handle
 * deciding which scope its drag should move, and the inspector deciding
 * whether the base row it is showing is the one the wheel actually reads.
 */
export function variantAuthoredOverrideIds(
  overrides: Readonly<Record<string, unknown>>,
  profile: WheelTypographyProfile,
): ReadonlySet<string> {
  const prefix = `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${profile}.`;
  const ids = new Set<string>();
  for (const semanticId of Object.keys(overrides)) {
    if (semanticId.startsWith(prefix)) ids.add(semanticId);
  }
  return ids;
}

/**
 * The variant id that masks a base authoring id, or null when none does.
 *
 * A base row is only masked when the wheel on screen has its own value for the
 * same class and property; anything that is not a base authoring id, or that
 * the variant leaves alone, is governing exactly as it appears.
 */
export function maskingVariantOverrideId(
  semanticId: string,
  profile: WheelTypographyProfile,
  variantAuthored: ReadonlySet<string>,
): string | null {
  const basePrefix = `${WHEEL_AUTHORING_OVERRIDE_PREFIX}base.`;
  if (!semanticId.startsWith(basePrefix)) return null;
  const variantId =
    `${WHEEL_AUTHORING_OVERRIDE_PREFIX}${profile}.${semanticId.slice(basePrefix.length)}`;
  return variantAuthored.has(variantId) ? variantId : null;
}

const FLAT_PROPERTY_NAMES: readonly WheelAuthoringFlatProperty[] = [
  "fontRef",
  "fontSize",
  "tracking",
  "color",
  "strokeWidth",
  "strokeStyle",
  "dashLength",
  "dashGap",
  "fillPattern",
  "shadowPattern",
  "cellSize",
  "dotSize",
  "backgroundColor",
  "patternColor",
  "gradientType",
  "gradientDirection",
  "gradientStartColor",
  "gradientEndColor",
  "gradientAngle",
  "textureMask",
  "maskDirection",
  "maskAngle",
  "maskAmount",
  "shadowColor",
  "shadowX",
  "shadowY",
  "shadowBlur",
  "density",
  "angle",
  "seed",
  "opacity",
  "lineCap",
  "lineJoin",
  "radius",
  "scale",
  "spanInner",
  "spanScale",
  "rulerDepth",
  "tickLength",
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
    if (property === "fontRef") {
      const fontRef = chartStyleFontRef(rawValue);
      if (fontRef) patch = { ...current, fontRef };
    } else if (property === "fontSize" && numericValue != null) {
      patch = { ...current, fontSize: chartPx(numericValue) };
    } else if (property === "tracking" && numericValue != null) {
      patch = { ...current, tracking: chartPx(numericValue) };
    } else if (property === "strokeWidth" && numericValue != null) {
      patch = { ...current, strokeWidth: chartPx(numericValue) };
    } else if (property === "dashLength" && numericValue != null) {
      patch = { ...current, dashLength: chartPx(numericValue) };
    } else if (property === "dashGap" && numericValue != null) {
      patch = { ...current, dashGap: chartPx(numericValue) };
    } else if (property === "cellSize" && numericValue != null) {
      patch = { ...current, cellSize: chartPx(numericValue) };
    } else if (property === "dotSize" && numericValue != null) {
      patch = { ...current, dotSize: chartPx(numericValue) };
    } else if (property === "shadowX" && numericValue != null) {
      patch = { ...current, shadowX: chartPx(numericValue) };
    } else if (property === "shadowY" && numericValue != null) {
      patch = { ...current, shadowY: chartPx(numericValue) };
    } else if (property === "shadowBlur" && numericValue != null) {
      patch = { ...current, shadowBlur: chartPx(numericValue) };
    } else if (property === "radius" && numericValue != null) {
      patch = { ...current, radius: chartPx(numericValue) };
    } else if (property === "spanInner" && numericValue != null) {
      // A reference-space radius like `radius`, but addressed to a span rather
      // than a painted ring, so the two can never be confused.
      patch = { ...current, spanInner: chartPx(numericValue) };
    } else if (property === "spanScale" && numericValue != null) {
      // A factor carried as a percentage, like the other share-of-something
      // values in this channel, and divided back at compile.
      patch = {
        ...current,
        spanScale: Math.min(
          WHEEL_BAND_SPAN_SCALE_RANGE.max * 100,
          Math.max(WHEEL_BAND_SPAN_SCALE_RANGE.min * 100, numericValue),
        ) / 100,
      };
    } else if (property === "rulerDepth" && numericValue != null) {
      // A share of the ruler's host band, so a ratio rather than a
      // reference-space dimension like `radius` — projecting it would measure
      // it against the wheel, which is the coupling this replaces.
      //
      // Carried through the flat channel as a percentage and divided here, the
      // same way `opacity` is: the flat channel holds the editor's conventional
      // values, and "32% of its band" is what the inspector shows.
      patch = {
        ...current,
        rulerDepth: Math.min(
          WHEEL_RULER_DEPTH_RANGE.max * 100,
          Math.max(WHEEL_RULER_DEPTH_RANGE.min * 100, numericValue),
        ) / 100,
      };
    } else if (property === "tickLength" && numericValue != null) {
      // A share of the tick's ruler band, carried as a percentage like
      // `rulerDepth` and divided at compile.
      patch = {
        ...current,
        tickLength: Math.min(
          WHEEL_TICK_LENGTH_RANGE.max * 100,
          Math.max(WHEEL_TICK_LENGTH_RANGE.min * 100, numericValue),
        ) / 100,
      };
    } else if (property === "scale" && numericValue != null) {
      // A ratio, not a chart-px dimension: it multiplies the wheel the other
      // sizes are measured against, so projecting it would apply it twice.
      patch = {
        ...current,
        scale: Math.min(
          WHEEL_SCALE_RANGE.max,
          Math.max(WHEEL_SCALE_RANGE.min, numericValue),
        ),
      };
    } else if (property === "density" && numericValue != null) {
      patch = { ...current, density: Math.min(100, Math.max(0, numericValue)) };
    } else if (property === "angle" && numericValue != null) {
      patch = { ...current, angle: Math.min(180, Math.max(-180, numericValue)) };
    } else if (property === "gradientAngle" && numericValue != null) {
      patch = { ...current, gradientAngle: Math.min(180, Math.max(-180, numericValue)) };
    } else if (property === "maskAngle" && numericValue != null) {
      patch = { ...current, maskAngle: Math.min(180, Math.max(-180, numericValue)) };
    } else if (property === "maskAmount" && numericValue != null) {
      patch = { ...current, maskAmount: Math.min(100, Math.max(0, numericValue)) };
    } else if (property === "seed" && numericValue != null) {
      patch = { ...current, seed: Math.min(65535, Math.max(0, Math.round(numericValue))) };
    } else if (property === "opacity" && numericValue != null) {
      patch = { ...current, opacity: Math.min(100, Math.max(0, numericValue)) / 100 };
    } else if (
      property === "strokeStyle"
      && (rawValue === "solid" || rawValue === "dashed" || rawValue === "dotted")
    ) {
      patch = { ...current, strokeStyle: rawValue };
    } else if (
      (property === "fillPattern" || property === "shadowPattern")
      && (
        rawValue === "none"
        || rawValue === "solid"
        || rawValue === "stipple"
        || rawValue === "bayer2"
        || rawValue === "bayer4"
        || rawValue === "bayer8"
        || rawValue === "noise"
        || rawValue === "blueNoise"
        || rawValue === "paper"
        || rawValue === "newsprint"
        || rawValue === "hatch"
        || rawValue === "crosshatch"
        || rawValue === "scanline"
        || rawValue === "atkinson"
        || rawValue === "floydSteinberg"
      )
    ) {
      patch = { ...current, [property]: rawValue };
    } else if (
      property === "gradientType"
      && (rawValue === "none" || rawValue === "linear" || rawValue === "radial")
    ) {
      patch = { ...current, gradientType: rawValue };
    } else if (
      (property === "gradientDirection" || property === "maskDirection")
      && (rawValue === "fixed" || rawValue === "sun")
    ) {
      patch = { ...current, [property]: rawValue };
    } else if (
      property === "textureMask"
      && (rawValue === "none" || rawValue === "crescent")
    ) {
      patch = { ...current, textureMask: rawValue };
    } else if (
      property === "backgroundColor"
      || property === "patternColor"
      || property === "gradientStartColor"
      || property === "gradientEndColor"
      || property === "shadowColor"
      || property === "color"
    ) {
      const color = chartStyleColor(rawValue);
      if (color) patch = { ...current, [property]: color };
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
    if (patch !== current) {
      classMaps[profile][classId] = Object.freeze(patch);
    }
  }
  return classMaps;
}

function chartStyleFontRef(rawValue: unknown): ChartStyleFontRef | null {
  if (rawValue == null || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return null;
  }
  const value = rawValue as Record<string, unknown>;
  if (value.role !== "text" && value.role !== "symbols") return null;
  if (
    value.source !== "bundled"
    && value.source !== "local"
    && value.source !== "asset"
    && value.source !== "generic"
  ) return null;
  if (
    !Array.isArray(value.family)
    || value.family.length === 0
    || value.family.some((family) => typeof family !== "string" || !family.trim())
    || typeof value.cssFamily !== "string"
    || !value.cssFamily.trim()
    || typeof value.style !== "string"
    || !value.style.trim()
    || typeof value.weight !== "number"
    || !Number.isFinite(value.weight)
    || value.weight < 1
    || value.weight > 1000
  ) return null;
  if (
    value.postscriptName != null
    && (typeof value.postscriptName !== "string" || !value.postscriptName.trim())
  ) return null;
  if (
    value.assetId != null
    && (typeof value.assetId !== "string" || !value.assetId.trim())
  ) return null;
  if (value.source === "asset" && value.assetId == null) return null;
  if (value.source === "local" && value.postscriptName == null) return null;
  let variationAxes: Readonly<Record<string, number>> | undefined;
  if (value.variationAxes != null) {
    if (
      typeof value.variationAxes !== "object"
      || Array.isArray(value.variationAxes)
      || Object.entries(value.variationAxes).some(
        ([axis, axisValue]) =>
          !axis.trim()
          || typeof axisValue !== "number"
          || !Number.isFinite(axisValue),
      )
    ) return null;
    variationAxes = Object.freeze({ ...(value.variationAxes as Record<string, number>) });
  }
  return Object.freeze({
    role: value.role,
    source: value.source,
    family: Object.freeze(value.family.map((family) => family.trim())),
    cssFamily: value.cssFamily.trim(),
    style: value.style.trim(),
    weight: value.weight,
    ...(value.postscriptName == null
      ? {} : { postscriptName: value.postscriptName.trim() }),
    ...(value.assetId == null ? {} : { assetId: value.assetId.trim() }),
    ...(variationAxes == null ? {} : { variationAxes }),
  });
}

function chartStyleColor(rawValue: unknown): ChartStyleColor | null {
  if (!Array.isArray(rawValue) || (rawValue.length !== 3 && rawValue.length !== 4)) {
    return null;
  }
  const components = rawValue.slice(0, 3).map(Number);
  if (components.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    return null;
  }
  const alpha = rawValue.length === 4 ? Number(rawValue[3]) : 1;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  return Object.freeze({
    colorSpace: "srgb",
    components: components as [number, number, number],
    ...(rawValue.length === 4 ? { alpha } : {}),
  });
}

function chartStyleColorCss(color: ChartStyleColor): string {
  const [red, green, blue] = color.components.map((channel) =>
    Math.max(0, Math.min(255, Math.round(Number(channel))))
  );
  return color.alpha == null
    ? `rgb(${red} ${green} ${blue})`
    : `rgb(${red} ${green} ${blue} / ${Math.max(0, Math.min(1, color.alpha)) * 100}%)`;
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

/**
 * The class that carries chart-wide geometry rather than one painted element.
 *
 * Scale lives here, not on a ring, because it is declared rather than inferred:
 * grabbing a ring must always mean "resize this band". Inferring scale from
 * which ring was grabbed also has no answer in the layouts where no painted
 * ring is outermost — a classic biwheel with houses hidden, or anglo synastry.
 */
export const WHEEL_CHART_CLASS_ID = "canvas.chart" as const;

/** The class carrying the inner edge of one band span. */
export function wheelBandSpanClassId(spanId: string): string {
  return `canvas.span.${spanId}`;
}

/**
 * The class that authors one degree ruler.
 *
 * A ruler is named as the parent of its own ticks rather than after the circle
 * it ends at. The circle is where the ruler stops, which is a consequence of
 * its depth, not the thing being authored — and naming it as the tick parent is
 * what makes the ruler own its ticks in the element list.
 */
const WHEEL_RULER_CLASS_IDS: Readonly<Record<WheelRulerId, string>> = Object.freeze({
  zodiacOuter: "zodiac.tick.outer",
  zodiacInner: "zodiac.tick.inner",
});

export function wheelRulerClassId(rulerId: WheelRulerId): string {
  return WHEEL_RULER_CLASS_IDS[rulerId];
}

/** The ruler a class authors, or null when the class is not a ruler. */
export function wheelRulerIdForClass(classId: string): WheelRulerId | null {
  for (const rulerId of WHEEL_RULER_IDS) {
    if (WHEEL_RULER_CLASS_IDS[rulerId] === classId) return rulerId;
  }
  return null;
}

/** The span a `canvas.span.*` class addresses, or null for any other class. */
export function wheelBandSpanIdForClass(classId: string): string | null {
  const spanId = classId.startsWith("canvas.span.")
    ? classId.slice("canvas.span.".length)
    : null;
  return spanId && Object.hasOwn(WHEEL_BAND_SPANS, spanId) ? spanId : null;
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

/**
 * The painted ring a ring class authors, if any. Exposed so a live drag can
 * find which boundary it is moving and push the rest of the stack with it.
 */
/** Every class whose radius authors a painted ring, in stack order. */
export const WHEEL_RING_CLASS_IDS: readonly string[] = Object.freeze(
  Object.keys(RING_CLASS_TO_ROLE),
);

export function wheelRingRoleForClass(
  classId: string,
): WheelPaintedRingRole | undefined {
  return RING_CLASS_TO_ROLE[classId];
}


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
  "aspects.interchart.endpointMarker": "bodyLeader",
  "secondaryRing.fixedStar.leader": "outerLeader",
  "secondaryRing.asteroid.leader": "outerLeader",
  "secondaryRing.midpoint.leader": "outerLeader",
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

function isFillClass(classId: string): classId is WheelAuthoringFillClass {
  return (WHEEL_AUTHORING_FILL_CLASSES as readonly string[]).includes(classId);
}

function lineOverride(
  properties: ChartStyleClassProperties,
): WheelAuthoringLinePaintOverride | undefined {
  if (
    properties.strokeWidth == null
    && properties.strokeStyle == null
    && properties.dashLength == null
    && properties.dashGap == null
    && properties.color == null
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
    ...(properties.color == null
      ? {} : { color: chartStyleColorCss(properties.color) }),
    ...(properties.opacity == null ? {} : { opacity: properties.opacity }),
    ...(properties.lineCap == null ? {} : { lineCap: properties.lineCap }),
    ...(properties.lineJoin == null ? {} : { lineJoin: properties.lineJoin }),
  });
}

function typographyOverride(
  properties: ChartStyleClassProperties,
): WheelAuthoringTypographyOverride | undefined {
  if (
    properties.fontRef == null
    && properties.fontSize == null
    && properties.tracking == null
    && properties.color == null
    && properties.opacity == null
  ) return undefined;
  return Object.freeze({
    ...(properties.fontRef == null
      ? {} : { fontRef: properties.fontRef as WheelAuthoringFontRef }),
    ...(properties.fontSize == null
      ? {} : { fontSizePx: properties.fontSize.value }),
    ...(properties.tracking == null
      ? {} : { trackingPx: properties.tracking.value }),
    ...(properties.color == null
      ? {} : { color: chartStyleColorCss(properties.color) }),
    ...(properties.opacity == null ? {} : { opacity: properties.opacity }),
  });
}

function fillOverride(
  properties: ChartStyleClassProperties,
): WheelAuthoringFillPaintOverride | undefined {
  if (
    properties.fillPattern == null
    && properties.cellSize == null
    && properties.dotSize == null
    && properties.backgroundColor == null
    && properties.patternColor == null
    && properties.gradientType == null
    && properties.gradientDirection == null
    && properties.gradientStartColor == null
    && properties.gradientEndColor == null
    && properties.gradientAngle == null
    && properties.textureMask == null
    && properties.maskDirection == null
    && properties.maskAngle == null
    && properties.maskAmount == null
    && properties.shadowPattern == null
    && properties.shadowColor == null
    && properties.shadowX == null
    && properties.shadowY == null
    && properties.shadowBlur == null
    && properties.opacity == null
    && properties.density == null
    && properties.angle == null
    && properties.seed == null
  ) return undefined;
  return Object.freeze({
    ...(properties.fillPattern == null
      ? {} : { fillPattern: properties.fillPattern }),
    ...(properties.cellSize == null
      ? {} : { cellSizePx: properties.cellSize.value }),
    ...(properties.dotSize == null
      ? {} : { dotSizePx: properties.dotSize.value }),
    ...(properties.backgroundColor == null
      ? {} : { backgroundColor: chartStyleColorCss(properties.backgroundColor) }),
    ...(properties.patternColor == null
      ? {} : { patternColor: chartStyleColorCss(properties.patternColor) }),
    ...(properties.gradientType == null
      ? {} : { gradientType: properties.gradientType }),
    ...(properties.gradientDirection == null
      ? {} : { gradientDirection: properties.gradientDirection }),
    ...(properties.gradientStartColor == null
      ? {} : { gradientStartColor: chartStyleColorCss(properties.gradientStartColor) }),
    ...(properties.gradientEndColor == null
      ? {} : { gradientEndColor: chartStyleColorCss(properties.gradientEndColor) }),
    ...(properties.gradientAngle == null
      ? {} : { gradientAngle: properties.gradientAngle }),
    ...(properties.textureMask == null
      ? {} : { textureMask: properties.textureMask }),
    ...(properties.maskDirection == null
      ? {} : { maskDirection: properties.maskDirection }),
    ...(properties.maskAngle == null ? {} : { maskAngle: properties.maskAngle }),
    ...(properties.maskAmount == null ? {} : { maskAmount: properties.maskAmount }),
    ...(properties.shadowPattern == null
      ? {} : { shadowPattern: properties.shadowPattern }),
    ...(properties.shadowColor == null
      ? {} : { shadowColor: chartStyleColorCss(properties.shadowColor) }),
    ...(properties.shadowX == null ? {} : { shadowXpx: properties.shadowX.value }),
    ...(properties.shadowY == null ? {} : { shadowYpx: properties.shadowY.value }),
    ...(properties.shadowBlur == null
      ? {} : { shadowBlurPx: properties.shadowBlur.value }),
    ...(properties.opacity == null ? {} : { opacity: properties.opacity }),
    ...(properties.density == null ? {} : { density: properties.density }),
    ...(properties.angle == null ? {} : { angle: properties.angle }),
    ...(properties.seed == null ? {} : { seed: properties.seed }),
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
  const typography: Record<
    string,
    Record<string, WheelAuthoringTypographyOverride>
  > = {};
  const linePaint: Record<string, Record<string, WheelAuthoringLinePaintOverride>> = {};
  const fillPaint: Record<string, Record<string, WheelAuthoringFillPaintOverride>> = {};
  const ringRadii: Record<string, Record<string, number>> = {};
  const wheelScale: Record<string, number> = {};
  const bandSpanInner: Record<string, Record<string, number>> = {};
  const bandSpanScale: Record<string, Record<string, number>> = {};
  const rulerDepth: Record<string, Record<string, number>> = {};
  const tickLength: Record<string, Record<string, number>> = {};
  for (const profile of ["classic", "compact", "anglo"] as const) {
    const classes = classMaps[profile];
    const authoredScale = classes[WHEEL_CHART_CLASS_ID]?.scale;
    if (authoredScale != null && Number.isFinite(authoredScale)) {
      wheelScale[profile] = Math.min(
        WHEEL_SCALE_RANGE.max,
        Math.max(WHEEL_SCALE_RANGE.min, authoredScale),
      );
    }
    const profileTypography: Record<string, WheelAuthoringTypographyOverride> = {};
    const profileLines: Record<string, WheelAuthoringLinePaintOverride> = {};
    const profileFills: Record<string, WheelAuthoringFillPaintOverride> = {};
    const profileRadii: Record<string, number> = {};
    const spanInners: Record<string, number> = {};
    for (const spanId of Object.keys(WHEEL_BAND_SPANS)) {
      const authored = classes[wheelBandSpanClassId(spanId)]?.spanInner;
      if (authored?.value != null && Number.isFinite(authored.value)) {
        spanInners[spanId] = authored.value;
      }
    }
    if (Object.keys(spanInners).length) bandSpanInner[profile] = spanInners;
    const spanScales: Record<string, number> = {};
    for (const spanId of Object.keys(WHEEL_BAND_SPANS)) {
      const authored = classes[wheelBandSpanClassId(spanId)]?.spanScale;
      if (authored != null && Number.isFinite(authored)) spanScales[spanId] = authored;
    }
    if (Object.keys(spanScales).length) bandSpanScale[profile] = spanScales;
    const rulerDepths: Record<string, number> = {};
    for (const rulerId of WHEEL_RULER_IDS) {
      const authored = classes[wheelRulerClassId(rulerId)]?.rulerDepth;
      if (authored != null && Number.isFinite(authored)) rulerDepths[rulerId] = authored;
    }
    if (Object.keys(rulerDepths).length) rulerDepth[profile] = rulerDepths;
    const tickLengths: Record<string, number> = {};
    for (const [classId, properties] of Object.entries(classes)) {
      const authored = properties.tickLength;
      if (authored != null && Number.isFinite(authored)) tickLengths[classId] = authored;
    }
    if (Object.keys(tickLengths).length) tickLength[profile] = tickLengths;
    for (const [classId, properties] of Object.entries(classes)) {
      if (isTypographyClass(classId)) {
        const directTypography = typographyOverride(properties);
        if (directTypography) profileTypography[classId] = directTypography;
      }
      if (isLineClass(classId)) {
        const directLine = lineOverride(properties);
        if (directLine) profileLines[classId] = directLine;
      }
      if (isFillClass(classId)) {
        const directFill = fillOverride(properties);
        if (directFill) profileFills[classId] = directFill;
      }
      const ringRole = RING_CLASS_TO_ROLE[classId];
      if (ringRole && properties.radius != null) {
        profileRadii[ringRole] = properties.radius.value;
      }
    }
    if (Object.keys(profileTypography).length) typography[profile] = profileTypography;
    if (Object.keys(profileLines).length) linePaint[profile] = profileLines;
    if (Object.keys(profileFills).length) fillPaint[profile] = profileFills;
    if (Object.keys(profileRadii).length) ringRadii[profile] = profileRadii;
  }
  return Object.freeze({
    referenceRadius: Number.isFinite(referenceRadius) && referenceRadius > 0
      ? referenceRadius
      : DEFAULT_WHEEL_AUTHORING_OVERRIDES.referenceRadius,
    typography: Object.freeze(typography),
    linePaint: Object.freeze(linePaint),
    fillPaint: Object.freeze(fillPaint),
    ringRadii: Object.freeze(ringRadii),
    wheelScale: Object.freeze(wheelScale),
    bandSpanInner: Object.freeze(bandSpanInner),
    bandSpanScale: Object.freeze(bandSpanScale),
    rulerDepth: Object.freeze(rulerDepth),
    tickLength: Object.freeze(tickLength),
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
  /**
   * Whether the class's colour and font were actually authored on this class,
   * as opposed to resolved from the shared palette/font role it inherits.
   *
   * Both values are always populated so the renderer has something concrete to
   * paint, which means presence alone cannot tell the inspector whether the
   * user ever set them. Without this distinction the inspector always edited a
   * per-class override and the shared role was unreachable — the reason the
   * Style Lab and the Appearance menu behaved as two disjoint systems.
   */
  colorAuthored?: boolean;
  fontRefAuthored?: boolean;
  fontRef?: WheelAuthoringFontRef;
  fontSizePx?: number;
  trackingPx?: number;
  color?: string;
  strokeWidthPx?: number;
  strokeStyle?: Exclude<WheelAuthoringStrokeStyle, "renderer">;
  dashOnPx?: number;
  dashOffPx?: number;
  opacityPercent?: number;
  fillPattern?: WheelAuthoringFillPattern;
  cellSizePx?: number;
  dotSizePx?: number;
  backgroundColor?: string;
  patternColor?: string;
  gradientType?: "none" | "linear" | "radial";
  gradientDirection?: "fixed" | "sun";
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientAngleDegrees?: number;
  textureMask?: "none" | "crescent";
  maskDirection?: "fixed" | "sun";
  maskAngleDegrees?: number;
  maskAmountPercent?: number;
  shadowPattern?: WheelAuthoringFillPattern;
  shadowColor?: string;
  shadowXpx?: number;
  shadowYpx?: number;
  shadowBlurPx?: number;
  densityPercent?: number;
  angleDegrees?: number;
  seed?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  radiusPx?: number;
  diameterPx?: number;
  /** Reference-space radius of a band span's inner edge. */
  spanInnerPx?: number;
  spanScalePercent?: number;
  rulerDepthPercent?: number;
  tickLengthPercent?: number;
}>;

export type WheelAuthoringClassDefaultContext = Readonly<{
  geometry?: WheelGeometryInput;
  targetWheelRadius?: number;
  baseLineWidthPx?: number;
  lineDefaults?: Readonly<{
    dash?: readonly number[];
    color?: string;
    opacity?: number;
    lineCap?: CanvasLineCap;
    lineJoin?: CanvasLineJoin;
  }>;
  runtimeFont?: string;
  runtimeFontRole?: "text" | "symbols";
  runtimeFontWeight?: number;
  runtimeFontStyle?: string;
  runtimeTrackingPx?: number;
  runtimeColor?: string;
  runtimeOpacity?: number;
  runtimeFontSizePx?: number;
}>;

function typographyFontRole(
  classId: WheelAuthoringTypographyClass,
): "text" | "symbols" {
  if (
    classId === "zodiac.signGlyph"
    || classId === "subdivisions.term.glyph"
    || classId === "subdivisions.decan.glyph"
    || classId.endsWith(".position.sign")
    || classId === "bodies.inner.glyph"
    || classId === "bodies.outer.glyph"
    || classId.startsWith("aspects.")
    || classId.endsWith(".glyph")
  ) return "symbols";
  return "text";
}

function typographyFontFallback(
  style: WheelRenderStyle,
  classId: WheelAuthoringTypographyClass,
): string {
  if (classId === "zodiac.signGlyph" || classId.endsWith(".position.sign")) {
    return style.typography.families.signSymbols;
  }
  if (classId === "subdivisions.term.glyph") {
    return style.typography.families.termSymbols;
  }
  if (classId === "subdivisions.decan.glyph") {
    return style.typography.families.decanSymbols;
  }
  if (classId === "bodies.inner.glyph" || classId === "bodies.outer.glyph") {
    return style.typography.families.bodySymbols;
  }
  if (classId.startsWith("aspects.")) {
    return style.typography.families.aspectSymbols;
  }
  if (typographyFontRole(classId) === "symbols") {
    return style.typography.families.symbols;
  }
  return style.typography.families.ui;
}

function typographyColorFallback(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringTypographyClass,
): string {
  // The zodiac ring's own glyphs are the signs role. A sign inside a position
  // readout is part of that reading and takes the positions role with its
  // degree and minute, matching what the renderer paints.
  if (classId === "zodiac.signGlyph") {
    return style.palette.signs;
  }
  if (classId === "subdivisions.term.glyph") return style.elementColors.termGlyph;
  if (classId === "subdivisions.decan.glyph") return style.elementColors.decanGlyph;
  if (classId.startsWith("houses.") && classId.endsWith(".label")) {
    return profile === "anglo"
      ? style.elementColors.angloHouseLabel
      : style.elementColors.houseLabel;
  }
  if (classId.startsWith("angles.") && classId.endsWith(".label")) {
    return style.elementColors.angleLabel;
  }
  if (classId.includes(".position.")) return style.palette.positions;
  if (classId.startsWith("surveil.")) {
    return style.palette.surveilAccent ?? style.palette.textBright;
  }
  if (classId.startsWith("secondaryRing.")) return style.palette.textDim;
  if (classId.startsWith("aspects.")) {
    return style.palette.aspects[0] ?? style.palette.textDim;
  }
  return style.palette.peregrin;
}

function portableFontRef(
  role: "text" | "symbols",
  cssFamily: string,
  weight: number,
  style: string,
): WheelAuthoringFontRef {
  return Object.freeze({
    role,
    source: cssFamily.includes("Aries") || cssFamily.includes("Morinus")
      ? "bundled"
      : "generic",
    family: Object.freeze([cssFamily]),
    cssFamily,
    style,
    weight,
  });
}

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

const ANGLO_HAIRLINE_DRAW_FALLBACK_CLASSES: readonly WheelAuthoringLineClass[] = [
  "rings.zodiacOuter",
  "rings.innerBoundary",
  "rings.base",
  "zodiac.spoke",
  "zodiac.tick.angloCuspRuler.10deg",
  "zodiac.tick.angloCuspRuler.5deg",
  "zodiac.tick.angloCuspRuler.1deg",
];

function defaultReferenceLineWidth(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringLineClass,
): number {
  const chartSize = style.authoringOverrides.referenceRadius * 2;
  // Anglo's production draw call sites deliberately use the hairline pen for
  // these classes instead of their generic ring/structural role fallback.
  if (
    profile === "anglo"
    && ANGLO_HAIRLINE_DRAW_FALLBACK_CLASSES.includes(classId)
  ) {
    return style.strokes.hairline;
  }
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

function defaultReferenceLineColor(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  classId: WheelAuthoringLineClass,
): string {
  const ringColors: Readonly<Partial<Record<WheelAuthoringLineClass, string>>> = {
    "rings.outerMaximum": style.elementColors.outerMaximumRing,
    "rings.outerHouse": style.elementColors.outerHouseRing,
    "rings.outerDegree": style.elementColors.outerDegreeRing,
    "rings.zodiacOuter": style.elementColors.zodiacOuterRing,
    "rings.innerDegree": style.elementColors.innerDegreeRing,
    "rings.zodiacInner": style.elementColors.zodiacInnerRing,
    "rings.term": style.elementColors.termRing,
    "rings.angloCuspOuter": style.elementColors.cuspOuterRing,
    "rings.innerBoundary": style.elementColors.innerBoundaryRing,
    "rings.aspectBoundary": style.elementColors.aspectBoundaryRing,
    "rings.houseBoundary": profile === "anglo"
      ? style.elementColors.angloHouseBoundaryRing
      : style.elementColors.houseBoundaryRing,
    "rings.base": profile === "anglo"
      ? style.elementColors.angloBaseRing
      : style.elementColors.baseRing,
  };
  const ringColor = ringColors[classId];
  if (ringColor) return ringColor;
  if (classId === "zodiac.spoke") return style.elementColors.zodiacSpoke;
  if (classId.startsWith("zodiac.tick.")) return style.palette.frame;
  if (classId === "subdivisions.term.boundary") {
    return style.elementColors.termBoundary;
  }
  if (classId === "subdivisions.decan.boundary") {
    return style.elementColors.decanBoundary;
  }
  if (classId.startsWith("houses.")) return style.elementColors.houseCusp;
  if (classId.startsWith("angles.")) return style.elementColors.angleRay;
  if (classId === "bodies.inner.leader") {
    return profile === "anglo"
      ? style.elementColors.angloBodyLeader
      : style.elementColors.bodyLeader;
  }
  if (
    classId === "bodies.outer.leader"
    || classId.startsWith("secondaryRing.")
  ) {
    return profile === "anglo"
      ? style.elementColors.angloOuterLeader
      : style.elementColors.outerLeader;
  }
  if (classId.startsWith("aspects.")) {
    return style.palette.aspects[0] ?? style.palette.frame;
  }
  if (classId === "surveil.tick") {
    return style.palette.surveilAccent ?? style.palette.textBright;
  }
  return style.palette.frame;
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
  const output: Record<string, unknown> = {};
  if (isTypographyClass(classId)) {
    const fallback = typographyFallback(
      style,
      profile,
      classId,
      targetRadius,
      context.runtimeFontSizePx,
    );
    const runtimeFont = context.runtimeFont
      ?? typographyFontFallback(style, classId);
    const runtimeColor = context.runtimeColor
      ?? typographyColorFallback(style, profile, classId);
    const paint = resolveWheelTypographyPaint(
      style,
      profile,
      classId,
      targetRadius,
      {
        font: runtimeFont,
        size: fallback,
        color: runtimeColor,
        weight: context.runtimeFontWeight,
        style: context.runtimeFontStyle,
        tracking: context.runtimeTrackingPx,
        opacity: context.runtimeOpacity,
      },
    );
    const direct = style.authoringOverrides.typography[profile]?.[classId];
    output.colorAuthored = direct?.color != null;
    output.fontRefAuthored = direct?.fontRef != null;
    output.fontRef = direct?.fontRef
      ?? portableFontRef(
        context.runtimeFontRole ?? typographyFontRole(classId),
        paint.font,
        paint.weight,
        paint.style,
      );
    output.fontSizePx = unprojectChartPx(paint.size, projection);
    output.trackingPx = unprojectChartPx(paint.tracking, projection);
    output.color = paint.color;
    output.opacityPercent = opacityToEditorPercent(paint.opacity);
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
        {
          ...context.lineDefaults,
          color: context.lineDefaults?.color
            ?? context.runtimeColor
            ?? defaultReferenceLineColor(style, profile, classId),
        },
        classId,
      );
      output.strokeWidthPx = paint.width;
      output.strokeStyle = resolvedStrokeStyle(paint);
      output.color = paint.fill;
      if (paint.dash) {
        output.dashOnPx = paint.dash[0] ?? 0;
        output.dashOffPx = paint.dash[1] ?? 0;
      }
      output.opacityPercent = opacityToEditorPercent(paint.opacity);
      // CanvasDraw supplies these defaults when a line paint omits them.
      // Expose the effective values so every advertised Profile V2 control is
      // reachable without first hand-authoring JSON.
      output.lineCap = paint.lineCap ?? "butt";
      output.lineJoin = paint.lineJoin ?? "miter";
    }
  }
  if (isFillClass(classId)) {
    const fill = resolveWheelFillPaint(
      projectWheelAuthoringStyle(style, referenceRadius, profile),
      profile,
      classId,
      referenceRadius,
    );
    output.fillPattern = fill.fillPattern;
    output.cellSizePx = fill.cellSizePx;
    output.dotSizePx = fill.dotSizePx;
    output.backgroundColor = fill.backgroundColor;
    output.patternColor = fill.patternColor;
    output.gradientType = fill.gradientType;
    output.gradientDirection = fill.gradientDirection;
    output.gradientStartColor = fill.gradientStartColor;
    output.gradientEndColor = fill.gradientEndColor;
    output.gradientAngleDegrees = fill.gradientAngle;
    if (classId !== "canvas.background") {
      output.textureMask = fill.textureMask;
      output.maskDirection = fill.maskDirection;
      output.maskAngleDegrees = fill.maskAngle;
      output.maskAmountPercent = fill.maskAmount;
      output.shadowPattern = fill.shadowPattern;
      output.shadowColor = fill.shadowColor;
      output.shadowXpx = unprojectChartPx(fill.shadowXpx, projection);
      output.shadowYpx = unprojectChartPx(fill.shadowYpx, projection);
      output.shadowBlurPx = unprojectChartPx(fill.shadowBlurPx, projection);
    }
    output.opacityPercent = opacityToEditorPercent(fill.opacity);
    output.densityPercent = fill.density;
    output.angleDegrees = fill.angle;
    output.seed = fill.seed;
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
  const spanId = wheelBandSpanIdForClass(classId);
  if (spanId && context.geometry) {
    // The span's inner edge is a resolved radius like a ring's, so the
    // inspector can show and type the same reference-space number the diamond
    // on the wheel drags. Without this the class had a handle and no row.
    const fields = resolveWheelBandSpanFields(context.geometry, spanId);
    const inner = fields
      ? resolveWheelRingSet(style, context.geometry)[fields.innerField]
      : undefined;
    if (typeof inner === "number" && Number.isFinite(inner) && inner > 0) {
      output.spanInnerPx = unprojectChartPx(inner, {
        wheelRadius: context.geometry.maxRadius,
        referenceRadius,
      });
      const outerField = fields?.outerField ?? null;
      const anchor = outerField === null
        ? context.geometry.maxRadius
        : resolveWheelRingSet(style, context.geometry)[outerField];
      if (typeof anchor === "number" && anchor - inner > 1e-9) {
        output.spanScalePercent = (resolveWheelBandSpanScale(
          style,
          context.geometry.profile,
          spanId,
          anchor,
          inner,
          context.geometry.maxRadius,
        ) ?? 1) * 100;
      }
    }
  }
  if (classId.startsWith("zodiac.tick.angloCuspRuler.") && context.geometry) {
    // The cusp ruler is the only degree ruler an ordinary anglo wheel draws, so
    // this is the tick length that matters there. Reported whether authored or
    // not, so the row shows the share the tick actually occupies.
    const rings = resolveWheelRingSet(style, context.geometry);
    const canonicalRings = resolveCanonicalWheelRingSet(style, context.geometry);
    const band = (rings.rCuspOuter ?? 0) - (rings.rCuspLabelOuter ?? 0);
    const canonicalBand =
      (canonicalRings.rCuspOuter ?? 0) - (canonicalRings.rCuspLabelOuter ?? 0);
    const ticks = style.geometry.anglo.cuspRulerTicks;
    const canonical = (rings.r30 ?? 0) * (
      classId.endsWith("10deg") ? ticks.long
        : classId.endsWith("5deg") ? ticks.medium
          : ticks.short
    );
    if (band > 0) {
      output.tickLengthPercent = (resolveWheelTickLength(
        style,
        "anglo",
        classId,
        band,
        canonicalBand,
        canonical,
      ) / band) * 100;
    }
  }
  const rulerId = wheelRulerIdForClass(classId);
  if (rulerId && context.geometry) {
    // Reported whether or not the ruler has been authored, so the row shows the
    // share it actually occupies instead of sitting blank until first touched.
    // Absent for a ruler with no host band — anglo's outer ruler on an outer
    // ring — which has no share of anything to report.
    const rings = resolveWheelRingSet(style, context.geometry);
    const terminal = rulerId === "zodiacOuter" ? rings.rOuter10 : rings.r10;
    const base = rulerId === "zodiacOuter" ? rings.rOuter0 : rings.r0;
    // A ruler that stands outside the zodiac band is hosted by the margin it
    // stands in — anglo's outer ruler, the only degree ruler anglo draws.
    const outsideZodiac = rulerId === "zodiacOuter"
      && typeof base === "number" && typeof rings.r30 === "number"
      && base > rings.r30;
    const band = outsideZodiac
      ? context.geometry.maxRadius - (rings.r30 ?? 0)
      : (rings.r30 ?? 0) - (rings.r0 ?? 0);
    if (band > 0 && typeof terminal === "number" && typeof base === "number") {
      output.rulerDepthPercent = (Math.abs(terminal - base) / band) * 100;
    }
  }
  return Object.freeze(output) as WheelAuthoringClassDefaults;
}
