// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Chart, ChartRenderSnapshot } from "./types";

/** Normal overlays follow the active outer subchart; synastry keeps its primary identity. */
export function informationDisplayChart(snapshot: ChartRenderSnapshot): Chart {
  return snapshot.document?.compoundKind === "synastry"
    ? snapshot.primaryChart
    : snapshot.comparisonChart ?? snapshot.primaryChart;
}

/** Paired participant identities keep their corners in Traditional presentation. */
export function hasRelationshipCornerInformation(chart: Chart): boolean {
  return Boolean(chart.meta.cornerLines?.pairedParticipants);
}

export function radixOverlayTopLeftLines(
  chart: Chart,
  radixChart?: Chart | null,
): string[] {
  const lines = chart.meta.cornerLines?.topLeft ?? [
    chart.meta.dateDisplay,
    chart.meta.timeDisplay,
  ];
  const name = (radixChart?.meta.name ?? chart.meta.name).trim();
  if (
    hasRelationshipCornerInformation(chart) ||
    chart.meta.cornerLines?.singleChart ||
    !chart.options.showRadixNameInCanvas ||
    chart.meta.kind === "composite" ||
    chart.meta.kind === "relationship" ||
    !name ||
    lines[0] === name
  ) {
    return lines;
  }
  return [name, ...lines];
}

/** Paired identities share one authored typography role in every renderer. */
export function informationCornerClass(chart: Chart, corner: "topLeft" | "bottomLeft") {
  return chart.meta.cornerLines?.pairedParticipants || corner === "topLeft"
    ? "chartOverlay.information.topLeft" as const
    : "chartOverlay.information.bottomLeft" as const;
}

/** TradMorinus single-wheel drawData dimensions, shared by both modes and selection targets. */
export function traditionalCenterInformationGeometry(
  chart: Chart,
  input: {maxRadius: number; mode: "single" | "comparison"; showTerms: boolean; showDecans: boolean},
  center: readonly [number, number],
) {
  const density = Number(input.showTerms) + Number(input.showDecans);
  const reduced = density === 2;
  return {
    size: input.maxRadius / (reduced ? 32 : 24),
    x: center[0] - input.maxRadius * 2 / (reduced ? 15 : 11),
    y: center[1] - input.maxRadius * 2 / (reduced ? 13 : 9),
    lines: chart.meta.centerLines ?? [chart.meta.dateDisplay, chart.meta.timeDisplay,
      chart.meta.place, chart.meta.placeCoords, chart.meta.name, ...(chart.meta.houseSystemLines ?? [])],
  };
}
