// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Chart } from "./types";

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
    chart.meta.cornerLines?.pairedParticipants ||
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
