// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type OuterGlyphLane = Readonly<{
  centerRadius: number;
  leaderRadius: number;
  outerRadius: number;
  gap: number;
}>;

/**
 * One deterministic radial lane for every glyph-only outer-ring family.
 * Leaders stop before the inward em-box edge; glyphs remain centered on the
 * authored radius. No text measurement or object-dependent layout is needed.
 */
export function resolveOuterGlyphLane(
  centerRadius: number,
  glyphSize: number,
  gap: number,
  innerLimit = 0,
): OuterGlyphLane {
  const safeCenter = Number.isFinite(centerRadius) ? Math.max(0, centerRadius) : 0;
  const safeSize = Number.isFinite(glyphSize) ? Math.max(0, glyphSize) : 0;
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  const halfSize = safeSize / 2;
  return Object.freeze({
    centerRadius: safeCenter,
    leaderRadius: Math.max(innerLimit, safeCenter - halfSize - safeGap),
    outerRadius: safeCenter + halfSize,
    gap: safeGap,
  });
}

/** Scale needed to keep a known radial paint extent inside its host. */
export function resolveOuterPaintEnvelopeScale(
  outerPaintRadius: number,
  wheelRadius: number,
): number {
  if (!(wheelRadius > 0) || !Number.isFinite(outerPaintRadius)) return 1;
  return Math.max(1, outerPaintRadius / wheelRadius);
}

export type ChartPaintTarget = Readonly<{
  side: number;
  centerY: number;
}>;

export type WheelVerticalAlignment = "center" | "upper";

/**
 * The largest the wheel may get in its pane, as proportions of the pane: the
 * wheel's rim (the zodiac's outer edge, `wheelOuterAttachmentRadius`) stays
 * within `height` × half the pane height and `width` × half the pane width.
 * `rimRadiusScale` is the rim radius per unit of half chart side for this
 * wheel geometry, so the cap holds for every geometry and screen.
 */
export type WheelRimLimit = Readonly<{
  rimRadiusScale: number;
  height: number;
  width: number;
}>;

/** The rim within 0.843 of half the pane height and 0.844 of half its width. */
export const WHEEL_RIM_LIMIT_DEFAULT = Object.freeze({ height: 0.843, width: 0.844 });

function rimLimitedSide(width: number, height: number, limit: WheelRimLimit | undefined): number {
  if (!limit || !(limit.rimRadiusScale > 0)) return Infinity;
  const byHeight = limit.height > 0 ? limit.height * height / limit.rimRadiusScale : Infinity;
  const byWidth = limit.width > 0 ? limit.width * width / limit.rimRadiusScale : Infinity;
  return Math.min(byHeight, byWidth);
}

/** Fit the wheel independently of the full-height corner-overlay host. */
export function resolveChartPaintTarget(
  hostWidth: number,
  hostHeight: number,
  paintRadiusScale: number,
  topBoundary = 0,
  avoidHeader = false,
  verticalAlignment: WheelVerticalAlignment = "center",
  targetScale = 1,
  rimLimit?: WheelRimLimit,
): ChartPaintTarget {
  const width = Math.max(1, hostWidth);
  const height = Math.max(1, hostHeight);
  const centerY = height / 2;
  const top = avoidHeader
    ? Math.min(centerY - 0.5, Math.max(0, topBoundary))
    : 0;
  const paintScale = Number.isFinite(paintRadiusScale) && paintRadiusScale > 0
    ? paintRadiusScale
    : 1;
  const baseSide = Math.min(width, height);
  const nominalSide = baseSide / (Number.isFinite(targetScale) ? Math.max(1, targetScale) : 1);
  const availableDiameter = avoidHeader
    ? Math.min(baseSide, Math.max(1, (centerY - top) * 2))
    : baseSide;
  const paintFitSide = availableDiameter / paintScale;
  const side = Math.max(1, Math.min(nominalSide, paintFitSide, rimLimitedSide(width, height, rimLimit)));
  // Split panes use half the spare space above the centered paint envelope.
  // This gently lifts width-limited wheels without shrinking them or changing
  // the corner-overlay bounds. Height-limited wheels keep their existing fit.
  const lift = verticalAlignment === "upper"
    ? Math.max(0, centerY - top - side * paintScale / 2) / 2
    : 0;
  return Object.freeze({
    side,
    centerY: centerY - lift,
  });
}
