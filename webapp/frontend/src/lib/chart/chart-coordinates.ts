// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Chart, ChartAngles, ChartRenderSnapshot } from "./types";
import { identityFrame, type WheelFrame } from "./wheel-projection";

export interface DrawingPoint {
  /** Absent in zodiacal scenes; null is an explicitly undefined projection. */
  drawingAngle?: number | null;
  mdo?: number;
  quadrant?: number;
}

/** Source longitude is never replaced by a projected coordinate. */
export function pointAngle(point: (DrawingPoint & { longitude: number }) | null | undefined): number {
  if (!point) return NaN;
  return point.drawingAngle === undefined ? point.longitude : point.drawingAngle ?? NaN;
}

export function drawingAngles(chart: Chart): ChartAngles {
  return chart.angles.drawing ? { ...chart.angles, ...chart.angles.drawing } : chart.angles;
}

export function drawingCusps(chart: Chart): number[] {
  return chart.houses.drawingCusps ?? chart.houses.cusps;
}

/**
 * An ascensional scene without equatorial signs uses the sign band as its
 * house band: twelve equal mundane sectors labelled by house, like the former
 * mundane chart view. Band radii are unchanged, so a mode switch never moves
 * the wheel.
 */
export function mundaneHouseBand(chart: Chart): boolean {
  return Boolean(chart.coordinateFrame) && !chart.coordinateFrame?.showEquatorialSigns;
}

/** Equatorial reference rays rotate with the RAMC; the house band follows the
 * structural mundane cross. */
export function referenceScaleFrame(chart: Chart, bodyFrame: WheelFrame): WheelFrame {
  return chart.coordinateFrame?.showEquatorialSigns ? identityFrame(chart.coordinateFrame.ramc + 90) : bodyFrame;
}

export function positionSignIndex(chart: Chart, drawingAngle: number): number | null {
  if (!chart.coordinateFrame) return Math.floor(((drawingAngle % 360 + 360) % 360) / 30);
  if (chart.coordinateFrame.readout !== 'equatorial-signs') return null;
  return Math.floor((((drawingAngle + chart.coordinateFrame.ramc + 90) % 360 + 360) % 360) / 30);
}

export function finitePointAngle(point: (DrawingPoint & { longitude: number }) | null | undefined): number | null {
  const angle = pointAngle(point);
  return Number.isFinite(angle) ? angle : null;
}

export function positionSignGlyph(chart: Chart, angle: number, glyph: (index: number, variant: 1 | 2) => string): string {
  const index = positionSignIndex(chart, angle);
  return index == null ? "" : glyph(index, chart.options.signVariant);
}

/** Capabilities are applied after live style drafts, leaving authored bands intact. */
export function constrainCoordinateChart(chart: Chart): Chart {
  const frame = chart.coordinateFrame;
  const housesOverride = chart.options.viewDisplayOverrides?.houses;
  if (!frame && housesOverride === undefined) return chart;
  const composition = chart.options.wheelComposition;
  const rings = composition?.rings.map(ring => ({...ring,
    enabled: ring.archetypeId === "houses" && housesOverride !== undefined ? housesOverride
      // Zodiac and degree bands keep their authored state: without equatorial
      // signs they become the house band and its mundane degree scale.
      : frame && (ring.archetypeId === "terms" || ring.archetypeId === "decans") ? false
      : ring.enabled,
  }));
  return {...chart, options: {...chart.options, ...(frame ? {showTerms: false, showDecans: false} : {}),
    ...(housesOverride !== undefined ? {showHouses: housesOverride} : {}),
    wheelComposition: composition && rings ? {...composition, rings} : composition}};
}

/** Only view-only/legacy snapshots, which carry no daemon presentation record
 * and no ascensional frame, still need the standalone mundane renderers. Chart
 * documents in either coordinate mode paint through the shared wheel. */
export function usesLegacyAscensionalRenderer(chart: ChartRenderSnapshot | null | undefined): boolean {
  return !chart?.document?.chartPresentation && !chart?.primaryChart.coordinateFrame;
}
