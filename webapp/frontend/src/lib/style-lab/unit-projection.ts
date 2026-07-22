// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Profile-v2 values are authored on one stable 800 x 800 chart artboard. The
 * production renderer may paint that artboard at any size, but backing pixels
 * and legacy normalized coefficients never leak into the editor.
 */
export const CHART_AUTHORING_REFERENCE_SPACE = Object.freeze({
  width: 800,
  height: 800,
  wheelRadius: 400,
  unit: "chart-px" as const,
});

export type ChartAuthoringReferenceSpace = typeof CHART_AUTHORING_REFERENCE_SPACE;
export type CircleSizeMode = "radius" | "diameter";

export type NumericBounds = Readonly<{
  min: number;
  max: number;
}>;

export type WheelUnitProjectionContext = Readonly<{
  /** Current production Canvas radius in CSS pixels. */
  wheelRadius: number;
  /** Profile source radius. Profile v2 normally uses 400 chart pixels. */
  referenceRadius?: number;
}>;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clampNumber(value: number, bounds: NumericBounds): number {
  const minimum = Math.min(bounds.min, bounds.max);
  const maximum = Math.max(bounds.min, bounds.max);
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

export function roundToPrecision(value: number, precision: number): number {
  const safePrecision = Math.max(0, Math.min(8, Math.trunc(finite(precision))));
  const factor = 10 ** safePrecision;
  return Math.round((finite(value) + Number.EPSILON) * factor) / factor;
}

export function wheelReferenceScale(
  context: WheelUnitProjectionContext,
): number {
  const referenceRadius = finite(
    context.referenceRadius ?? CHART_AUTHORING_REFERENCE_SPACE.wheelRadius,
    CHART_AUTHORING_REFERENCE_SPACE.wheelRadius,
  );
  const wheelRadius = finite(context.wheelRadius, referenceRadius);
  if (referenceRadius <= 0 || wheelRadius < 0) return 1;
  return wheelRadius / referenceRadius;
}

/** Convert a profile-v2 chart-pixel value to current production Canvas px. */
export function projectChartPx(
  authoringPx: number,
  context: WheelUnitProjectionContext,
): number {
  return finite(authoringPx) * wheelReferenceScale(context);
}

/** Convert a current production Canvas px value back to profile-v2 chart px. */
export function unprojectChartPx(
  runtimePx: number,
  context: WheelUnitProjectionContext,
): number {
  const scale = wheelReferenceScale(context);
  return scale === 0 ? 0 : finite(runtimePx) / scale;
}

/** The editor displays normalized Canvas opacity as an ordinary percentage. */
export function opacityToEditorPercent(opacity: number): number {
  return clampNumber(finite(opacity) * 100, { min: 0, max: 100 });
}

/** Profile/runtime opacity remains the Canvas-native 0..1 value. */
export function editorPercentToOpacity(percent: number): number {
  return clampNumber(finite(percent) / 100, { min: 0, max: 1 });
}

export function normalizeDegrees(degrees: number): number {
  const normalized = finite(degrees) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/** Radius is the sole stored circle authority; diameter is only a projection. */
export function radiusToCircleSize(
  radius: number,
  mode: CircleSizeMode,
): number {
  const safeRadius = Math.max(0, finite(radius));
  return mode === "diameter" ? safeRadius * 2 : safeRadius;
}

/** Editing diameter resolves immediately back to the one radius authority. */
export function circleSizeToRadius(
  displayedSize: number,
  mode: CircleSizeMode,
): number {
  const safeSize = Math.max(0, finite(displayedSize));
  return mode === "diameter" ? safeSize / 2 : safeSize;
}

export function clampRadiusToNeighbours(
  radius: number,
  bounds: Readonly<{
    innerRadius?: number;
    outerRadius?: number;
    minimumGap?: number;
    hardBounds?: NumericBounds;
  }>,
): number {
  const hardBounds = bounds.hardBounds ?? {
    min: 0,
    max: CHART_AUTHORING_REFERENCE_SPACE.wheelRadius,
  };
  const gap = Math.max(0, finite(bounds.minimumGap ?? 2));
  const minimum = bounds.innerRadius == null
    ? hardBounds.min
    : finite(bounds.innerRadius) + gap;
  const maximum = bounds.outerRadius == null
    ? hardBounds.max
    : finite(bounds.outerRadius) - gap;
  const safeMaximum = Math.max(hardBounds.min, Math.min(hardBounds.max, maximum));
  const safeMinimum = Math.min(safeMaximum, Math.max(hardBounds.min, minimum));
  return clampNumber(radius, { min: safeMinimum, max: safeMaximum });
}
