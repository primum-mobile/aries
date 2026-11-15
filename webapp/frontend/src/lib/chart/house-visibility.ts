// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Chart, ChartRenderSnapshot } from "./types";

/** Project a daemon display flag onto retained geometry, including split peers.
 * The daemon exports the capability rule for angles-only/comparison charts.
 * No points, dates, aspects, overlay facts or authored geometry are rebuilt. */
export function withHouseVisibility(
  snapshot: ChartRenderSnapshot,
  enabled: boolean,
): ChartRenderSnapshot {
  const effectiveEnabled = snapshot.document?.chartPresentation?.displayOverrides.houses ?? enabled;
  const project = (chart: Chart | null | undefined): typeof chart => {
    if (!chart) return chart;
    const showHouses = effectiveEnabled && chart.options.houseLinesAvailable !== false;
    const composition = chart.options.wheelComposition;
    const changedComposition = composition?.rings.some(ring => ring.archetypeId === "houses" && ring.enabled !== effectiveEnabled);
    if (chart.options.showHouses === showHouses && !changedComposition) return chart;
    return {
      ...chart,
      options: {
        ...chart.options,
        showHouses,
        ...(changedComposition && composition ? {
          wheelComposition: {
            ...composition,
            rings: composition.rings.map(ring => ring.archetypeId === "houses" ? { ...ring, enabled: effectiveEnabled } : ring),
          },
        } : {}),
      },
    };
  };
  const primaryChart = project(snapshot.primaryChart)!;
  const comparisonChart = project(snapshot.comparisonChart);
  const radixChart = project(snapshot.radixChart);
  const displayAnchorChart = project(snapshot.displayAnchorChart);
  const rings = snapshot.rings?.map(chart => project(chart)!);
  const sideBySideSnapshotsBySide = snapshot.sideBySideSnapshotsBySide && Object.fromEntries(
    Object.entries(snapshot.sideBySideSnapshotsBySide).map(([side, peer]) => [side, withHouseVisibility(peer, enabled)]),
  );
  const sidePeersChanged = sideBySideSnapshotsBySide && Object.entries(sideBySideSnapshotsBySide).some(
    ([side, peer]) => peer !== snapshot.sideBySideSnapshotsBySide![side as "left" | "right"],
  );
  const sideBySideSnapshots = snapshot.sideBySideSnapshots && Object.fromEntries(
    Object.entries(snapshot.sideBySideSnapshots).map(([id, peer]) => [id, withHouseVisibility(peer, enabled)]),
  );
  const ringsChanged = rings?.some((ring, index) => ring !== snapshot.rings![index]);
  const peersChanged = sideBySideSnapshots && Object.entries(sideBySideSnapshots).some(
    ([id, peer]) => peer !== snapshot.sideBySideSnapshots![id],
  );
  if (primaryChart === snapshot.primaryChart && comparisonChart === snapshot.comparisonChart
    && radixChart === snapshot.radixChart && displayAnchorChart === snapshot.displayAnchorChart && !ringsChanged && !peersChanged && !sidePeersChanged) return snapshot;
  return {
    ...snapshot, primaryChart, comparisonChart, radixChart, displayAnchorChart,
    ...(ringsChanged ? { rings } : {}),
    ...(peersChanged ? { sideBySideSnapshots } : {}),
    ...(sidePeersChanged ? { sideBySideSnapshotsBySide } : {}),
    // A display command owes a visible paint even on a previously settled frame.
    settleOverlayOnly: false,
    renderInvalidation: { geometry: true, dynamic: true, outerLabel: true, deferredOuterLabel: false },
  };
}

export function snapshotHouseVisibility(snapshot: ChartRenderSnapshot): boolean {
  return snapshot.primaryChart.options.wheelComposition?.rings.find(ring => ring.archetypeId === "houses")?.enabled
    ?? snapshot.primaryChart.options.showHouses !== false;
}
