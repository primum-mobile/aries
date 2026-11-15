// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Chart, ChartRenderSnapshot } from "./types";

export function overlayPerfState(snapshot: ChartRenderSnapshot) {
  const displayChart =
    snapshot.document?.compoundKind === "synastry" && snapshot.comparisonChart
      ? snapshot.primaryChart
      : snapshot.comparisonChart ?? snapshot.primaryChart;
  const rows = displayChart.overlay?.rows ?? [];
  const groupCounts = { dayhour: 0, header: 0, signal: 0 };
  const signatures = rows.map((row) => {
    const group = row.group ?? "row";
    if (group === "dayhour" || group === "header" || group === "signal") {
      groupCounts[group] += 1;
    }
    const glyphs = row.glyphs
      .map((glyph) => `${glyph.kind ?? ""}:${glyph.seId ?? ""}:${glyph.char}`)
      .join("|");
    return {
      group,
      slot: row.slot ?? null,
      signature: `${row.slot ?? row.label}:${glyphs}:${row.trailing ?? ""}`,
    };
  });
  return {
    coordinateMode: snapshot.primaryChart.coordinateFrame ? "ascensional" : "zodiacal",
    coordinateRevision: snapshot.primaryChart.coordinateFrame?.revision,
    contactMethod: snapshot.ascensionalScene?.contactMethod ?? (snapshot.primaryChart.coordinateFrame ? "mdo" : "zodiacal"),
    deferredSignals: displayChart.overlay?.deferredSignals === true,
    groupCounts,
    rows: signatures,
  };
}


function semanticChartFrameSignature(chart: Chart | null | undefined): string {
  if (!chart) return "none";
  const degrees = (value: number) => Number(value).toFixed(8);
  return [
    chart.meta.datetime,
    `asc:${degrees(chart.angles.asc)}`,
    `mc:${degrees(chart.angles.mc)}`,
    ...chart.planets.map((planet) => `${planet.id}:${degrees(planet.longitude)}`),
  ].join("|");
}

export function semanticFrameSignature(snapshot: ChartRenderSnapshot): string {
  return [
    snapshot.displayDatetime,
    `primary:${semanticChartFrameSignature(snapshot.primaryChart)}`,
    `comparison:${semanticChartFrameSignature(snapshot.comparisonChart)}`,
  ].join("||");
}
