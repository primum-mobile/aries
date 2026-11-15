// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
// Compose the existing outer-label painter with the independent tri/quad stack.
import { pointAngle } from "./chart-coordinates";
import type { CanvasDraw } from "./canvas-draw";
import { paintProjectedOuterRing, resolveProjectedOuterRing, type DrawOptions } from "./draw-chart";
import type { MultiwheelHitRegion } from "./multiwheel-render-style";
import type { ChartRenderSnapshot } from "./types";
import { identityFrame } from "./wheel-projection";

export function multiwheelOuterScene(snapshot: ChartRenderSnapshot, options: DrawOptions, boundaryRadius: number) {
  const items = (snapshot.outerRingItems?.[snapshot.outerRingMode] ?? []).filter(item => Number.isFinite(pointAngle(item)));
  if (!items.length) return null;
  const index = snapshot.outerRingChartIndex ?? (items[0].role === "outer" ? (snapshot.rings?.length ?? 1) - 1 : 0);
  const chart = snapshot.rings?.[index] ?? snapshot.primaryChart;
  return {index, scene: resolveProjectedOuterRing(snapshot, options, {chart, items,
    frame: identityFrame(snapshot.primaryChart.coordinateFrame ? 0 : snapshot.primaryChart.angles.asc), boundaryRadius})};
}

export function paintMultiwheelOuterRing(draw: CanvasDraw, overlay: ReturnType<typeof multiwheelOuterScene>): MultiwheelHitRegion[] {
  if (!overlay) return [];
  const {scene, index} = overlay;
  const hits: MultiwheelHitRegion[] = [];
  paintProjectedOuterRing(draw, scene, (item, bounds) => {
    hits.push({kind: "secondary_ring", itemId: item.id, family: item.family, label: item.label,
      longitude: item.longitude, searchObjectId: item.searchObjectId,
      x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2, r: Math.max(bounds.w, bounds.h) / 2,
      shape: "rect", left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h,
      chartRole: index ? "outer" : "primary", ringIndex: index,
      viewDocumentId: scene.snapshot.document?.documentId,
      coordinateMode: scene.chart.coordinateFrame ? "ascensional" : "zodiacal",
      coordinateRevision: scene.chart.coordinateFrame?.revision});
  });
  return hits;
}
