// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CHART_AUTHORING_REFERENCE_SPACE,
  circleSizeToRadius,
  clampNumber,
  editorPercentToOpacity,
  normalizeDegrees,
  opacityToEditorPercent,
  projectChartPx,
  radiusToCircleSize,
  roundToPrecision,
  unprojectChartPx,
  type CircleSizeMode,
  type NumericBounds,
  type WheelUnitProjectionContext,
} from "./unit-projection";

export { CHART_AUTHORING_REFERENCE_SPACE } from "./unit-projection";

export const CHART_STYLE_PROFILE_SCHEMA_VERSION = 2 as const;
export const CHART_STYLE_CLASS_MANIFEST_VERSION = "wheel-v2" as const;

export type AuthoringEditorUnit = "px" | "%" | "deg" | "";
export type AuthoringNumericProjection =
  | "chart-px"
  | "opacity"
  | "degrees"
  | "identity";

export type AuthoringNumericPropertyDefinition = Readonly<{
  editorUnit: AuthoringEditorUnit;
  step: number;
  fineStep: number;
  largeStep: number;
  precision: number;
  softBounds: NumericBounds;
  hardBounds: NumericBounds;
  projection: AuthoringNumericProjection;
  /** Renderer/internal value -> conventional value shown in the editor. */
  toEditor: (value: number, context?: WheelUnitProjectionContext) => number;
  /** Conventional editor value -> renderer/internal value, safely bounded. */
  fromEditor: (value: number, context?: WheelUnitProjectionContext) => number;
}>;

export type AuthoringNumericPreset =
  | "glyphSize"
  | "labelSize"
  | "strokeWidth"
  | "dashLength"
  | "patternCell"
  | "patternDot"
  | "patternDensity"
  | "patternAngle"
  | "patternSeed"
  | "radius"
  | "offset"
  | "opacity"
  | "blur"
  | "shadowOffset"
  | "hue"
  | "filterAmount"
  | "fontWeight"
  | "tracking";

const REFERENCE_CONTEXT: WheelUnitProjectionContext = Object.freeze({
  wheelRadius: CHART_AUTHORING_REFERENCE_SPACE.wheelRadius,
});

function bounded(value: number, bounds: NumericBounds, precision: number): number {
  return roundToPrecision(clampNumber(value, bounds), precision);
}

function createNumericProperty(
  input: Omit<
    AuthoringNumericPropertyDefinition,
    "toEditor" | "fromEditor"
  >,
): AuthoringNumericPropertyDefinition {
  const toEditor = (
    value: number,
    context: WheelUnitProjectionContext = REFERENCE_CONTEXT,
  ): number => {
    let projected = value;
    if (input.projection === "chart-px") projected = unprojectChartPx(value, context);
    else if (input.projection === "opacity") projected = opacityToEditorPercent(value);
    else if (input.projection === "degrees") projected = normalizeDegrees(value);
    return roundToPrecision(projected, input.precision);
  };
  const fromEditor = (
    value: number,
    context: WheelUnitProjectionContext = REFERENCE_CONTEXT,
  ): number => {
    const safeEditorValue = bounded(value, input.hardBounds, input.precision);
    if (input.projection === "chart-px") return projectChartPx(safeEditorValue, context);
    if (input.projection === "opacity") return editorPercentToOpacity(safeEditorValue);
    if (input.projection === "degrees") return normalizeDegrees(safeEditorValue);
    return safeEditorValue;
  };
  return Object.freeze({ ...input, toEditor, fromEditor });
}

/**
 * Reusable property semantics for the compact inspector. A semantic class
 * chooses the applicable preset; there is deliberately no universal slider
 * range for every numeric property.
 */
export const AUTHORING_NUMERIC_PROPERTIES: Readonly<
  Record<AuthoringNumericPreset, AuthoringNumericPropertyDefinition>
> = Object.freeze({
  glyphSize: createNumericProperty({
    editorUnit: "px", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: 6, max: 64 }, hardBounds: { min: 1, max: 128 },
    projection: "chart-px",
  }),
  labelSize: createNumericProperty({
    editorUnit: "px", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: 6, max: 48 }, hardBounds: { min: 1, max: 96 },
    projection: "chart-px",
  }),
  strokeWidth: createNumericProperty({
    editorUnit: "px", step: 0.25, fineStep: 0.05, largeStep: 1, precision: 2,
    softBounds: { min: 0.25, max: 6 }, hardBounds: { min: 0, max: 16 },
    projection: "chart-px",
  }),
  dashLength: createNumericProperty({
    editorUnit: "px", step: 1, fineStep: 0.25, largeStep: 10, precision: 2,
    softBounds: { min: 0, max: 24 }, hardBounds: { min: 0, max: 96 },
    projection: "chart-px",
  }),
  patternCell: createNumericProperty({
    editorUnit: "px", step: 0.5, fineStep: 0.1, largeStep: 2, precision: 1,
    softBounds: { min: 1, max: 16 }, hardBounds: { min: 0.5, max: 48 },
    projection: "chart-px",
  }),
  patternDot: createNumericProperty({
    editorUnit: "px", step: 0.25, fineStep: 0.05, largeStep: 1, precision: 2,
    softBounds: { min: 0.25, max: 4 }, hardBounds: { min: 0.25, max: 24 },
    projection: "chart-px",
  }),
  patternDensity: createNumericProperty({
    editorUnit: "%", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: 0, max: 100 }, hardBounds: { min: 0, max: 100 },
    projection: "identity",
  }),
  patternAngle: createNumericProperty({
    editorUnit: "deg", step: 1, fineStep: 0.1, largeStep: 15, precision: 1,
    softBounds: { min: -180, max: 180 }, hardBounds: { min: -180, max: 180 },
    projection: "identity",
  }),
  patternSeed: createNumericProperty({
    editorUnit: "", step: 1, fineStep: 1, largeStep: 100, precision: 0,
    softBounds: { min: 0, max: 65535 }, hardBounds: { min: 0, max: 65535 },
    projection: "identity",
  }),
  radius: createNumericProperty({
    editorUnit: "px", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: 0, max: 400 }, hardBounds: { min: 0, max: 400 },
    projection: "chart-px",
  }),
  offset: createNumericProperty({
    editorUnit: "px", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: -32, max: 32 }, hardBounds: { min: -200, max: 200 },
    projection: "chart-px",
  }),
  opacity: createNumericProperty({
    editorUnit: "%", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: 0, max: 100 }, hardBounds: { min: 0, max: 100 },
    projection: "opacity",
  }),
  blur: createNumericProperty({
    editorUnit: "px", step: 0.5, fineStep: 0.1, largeStep: 5, precision: 1,
    softBounds: { min: 0, max: 24 }, hardBounds: { min: 0, max: 64 },
    projection: "chart-px",
  }),
  shadowOffset: createNumericProperty({
    editorUnit: "px", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: -24, max: 24 }, hardBounds: { min: -128, max: 128 },
    projection: "chart-px",
  }),
  hue: createNumericProperty({
    editorUnit: "deg", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: 0, max: 360 }, hardBounds: { min: -36000, max: 36000 },
    projection: "degrees",
  }),
  filterAmount: createNumericProperty({
    editorUnit: "%", step: 1, fineStep: 0.1, largeStep: 10, precision: 1,
    softBounds: { min: 0, max: 200 }, hardBounds: { min: 0, max: 400 },
    projection: "identity",
  }),
  fontWeight: createNumericProperty({
    editorUnit: "", step: 1, fineStep: 1, largeStep: 100, precision: 0,
    softBounds: { min: 100, max: 900 }, hardBounds: { min: 1, max: 1000 },
    projection: "identity",
  }),
  tracking: createNumericProperty({
    editorUnit: "px", step: 0.1, fineStep: 0.01, largeStep: 1, precision: 2,
    softBounds: { min: -4, max: 12 }, hardBounds: { min: -32, max: 64 },
    projection: "chart-px",
  }),
});

export type ChartStyleDimension = Readonly<{ value: number; unit: "px" }>;
export type ChartStyleColor = Readonly<{
  colorSpace: "srgb";
  components: readonly [number, number, number];
  alpha?: number;
}>;
export type ChartStyleStrokeStyle = "solid" | "dashed" | "dotted";
export type ChartStyleFillPattern =
  | "none"
  | "solid"
  | "stipple"
  | "bayer2"
  | "bayer4"
  | "bayer8"
  | "noise"
  | "blueNoise"
  | "paper"
  | "newsprint"
  | "hatch"
  | "crosshatch"
  | "scanline"
  | "atkinson"
  | "floydSteinberg";
export type ChartStyleGradientType = "none" | "linear" | "radial";
export type ChartStyleDirectionSource = "fixed" | "sun";
export type ChartStyleTextureMask = "none" | "crescent";
export type ChartStyleLineCap = "butt" | "round" | "square";
export type ChartStyleLineJoin = "bevel" | "round" | "miter";

export type ChartStyleFontRef = Readonly<{
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

export type ChartStyleClassProperties = Readonly<{
  radius?: ChartStyleDimension;
  /**
   * Unitless multiplier on the whole wheel, authored only by `canvas.chart`.
   *
   * Deliberately not a dimension: it is a ratio, so it must survive projection
   * into any target radius unchanged. Every other size here is reference-space
   * px and is scaled by this one.
   */
  scale?: number;
  /** A band span's inner edge, in reference-space px. */
  spanInner?: ChartStyleDimension;
  /** How much a band span scales its run, about the run's outer anchor. */
  spanScale?: number;
  /**
   * A degree ruler's depth, as a share of the band that hosts it.
   *
   * A ratio rather than a dimension: the ruler is sized against its band, not
   * against the wheel, which is what lets ticks follow a resized band without
   * being coupled to glyph size.
   */
  rulerDepth?: number;
  /** One tick group's length, as a share of its ruler band. */
  tickLength?: number;
  strokeWidth?: ChartStyleDimension;
  strokeStyle?: ChartStyleStrokeStyle;
  dashLength?: ChartStyleDimension;
  dashGap?: ChartStyleDimension;
  fillPattern?: ChartStyleFillPattern;
  shadowPattern?: ChartStyleFillPattern;
  cellSize?: ChartStyleDimension;
  dotSize?: ChartStyleDimension;
  backgroundColor?: ChartStyleColor;
  patternColor?: ChartStyleColor;
  gradientType?: ChartStyleGradientType;
  gradientDirection?: ChartStyleDirectionSource;
  gradientStartColor?: ChartStyleColor;
  gradientEndColor?: ChartStyleColor;
  gradientAngle?: number;
  textureMask?: ChartStyleTextureMask;
  maskDirection?: ChartStyleDirectionSource;
  maskAngle?: number;
  maskAmount?: number;
  density?: number;
  angle?: number;
  seed?: number;
  lineCap?: ChartStyleLineCap;
  lineJoin?: ChartStyleLineJoin;
  fontRef?: ChartStyleFontRef;
  fontSize?: ChartStyleDimension;
  tracking?: ChartStyleDimension;
  color?: ChartStyleColor;
  opacity?: number;
  blur?: ChartStyleDimension;
  shadowColor?: ChartStyleColor;
  shadowX?: ChartStyleDimension;
  shadowY?: ChartStyleDimension;
  shadowBlur?: ChartStyleDimension;
  hueRotate?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
}>;

export type ChartStyleVariant = "classic" | "compact" | "anglo";
export type ChartStyleClassMap = Readonly<Record<string, ChartStyleClassProperties>>;

export type ChartStyleProfileV2 = Readonly<{
  $schema: string;
  profileSchemaVersion: typeof CHART_STYLE_PROFILE_SCHEMA_VERSION;
  classManifestVersion: typeof CHART_STYLE_CLASS_MANIFEST_VERSION | string;
  base: Readonly<{ id: string; contentHash: string }>;
  referenceSpace: typeof CHART_AUTHORING_REFERENCE_SPACE;
  styles: ChartStyleClassMap;
  variants: Readonly<Partial<Record<ChartStyleVariant, ChartStyleClassMap>>>;
}>;

export function chartPx(value: number): ChartStyleDimension {
  return Object.freeze({ value, unit: "px" as const });
}

export function resolveVariantClassStyle(
  profile: Pick<ChartStyleProfileV2, "styles" | "variants">,
  classId: string,
  variant: ChartStyleVariant,
): ChartStyleClassProperties {
  return Object.freeze({
    ...(profile.styles[classId] ?? {}),
    ...(profile.variants[variant]?.[classId] ?? {}),
  });
}

export function circleSizeFromStyle(
  style: Pick<ChartStyleClassProperties, "radius">,
  mode: CircleSizeMode,
): number | undefined {
  return style.radius == null
    ? undefined
    : radiusToCircleSize(style.radius.value, mode);
}

export function styleWithCircleSize(
  style: ChartStyleClassProperties,
  displayedSize: number,
  mode: CircleSizeMode,
): ChartStyleClassProperties {
  return Object.freeze({
    ...style,
    radius: chartPx(circleSizeToRadius(displayedSize, mode)),
  });
}
