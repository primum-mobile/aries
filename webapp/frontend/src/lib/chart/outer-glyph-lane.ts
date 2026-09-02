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

/** Fit one known radial paint envelope around the host's permanent centre. */
export function resolveChartPaintTarget(
  hostWidth: number,
  hostHeight: number,
  paintRadiusScale: number,
  topBoundary = 0,
  avoidHeader = false,
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
  const availableDiameter = avoidHeader
    ? Math.min(baseSide, Math.max(1, (centerY - top) * 2))
    : baseSide;
  const paintFitSide = availableDiameter / paintScale;
  return Object.freeze({
    side: Math.max(1, Math.min(baseSide, paintFitSide)),
    centerY,
  });
}
