// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartRenderSnapshot } from "./types";

export type ChartSourceRole = "primary" | "outer";
export type BodyRingTrack = "inner" | "outer";

export interface PdBodyTrackPresentation {
  sourceRole: ChartSourceRole;
  track: BodyRingTrack;
}

export interface PdRingPresentation {
  traditionalConverse: boolean;
  primaryBodies: PdBodyTrackPresentation;
  comparisonBodies: PdBodyTrackPresentation;
  /** Zodiac, houses and natal axes always belong to the primary framework. */
  frameworkSourceRole: "primary";
  showComparisonHouses: boolean;
  showComparisonAxes: boolean;
}

type PdRingSnapshot = Pick<ChartRenderSnapshot, "comparisonChart" | "document">;

/**
 * Resolve source identity separately from radial presentation.
 *
 * The daemon keeps `primaryChart` as the radix/framework and
 * `comparisonChart` as the directed source in both reference frames. Only the
 * radial tracks invert for traditional converse; source roles remain stable so
 * hover, click filtering and inspector routing keep addressing the right chart.
 */
export function resolvePdRingPresentation(
  snapshot: PdRingSnapshot,
): PdRingPresentation {
  const traditionalConverse = Boolean(
    snapshot.comparisonChart &&
      snapshot.document?.pdInChartFrame === "traditional-converse",
  );

  return {
    traditionalConverse,
    primaryBodies: {
      sourceRole: "primary",
      track: traditionalConverse ? "outer" : "inner",
    },
    comparisonBodies: {
      sourceRole: "outer",
      track: traditionalConverse ? "inner" : "outer",
    },
    frameworkSourceRole: "primary",
    showComparisonHouses: Boolean(snapshot.comparisonChart) && !traditionalConverse,
    showComparisonAxes: Boolean(snapshot.comparisonChart) && !traditionalConverse,
  };
}

export interface BodyTrackRadii {
  inner: number;
  outer: number;
}

export interface ComparisonBodyLayoutContext {
  anglo: boolean;
  primaryShowsHouses: boolean;
  primaryShowsCusplessAscMcLabels: boolean;
  showOuterHouseCusps: boolean;
  restrainedAngloComparison: boolean;
}

export interface ComparisonBodyLayoutPlan<T> {
  bodyChart: T;
  frameworkChart: T;
  includeAngles: boolean;
  includePositionStacks: boolean;
  includeSharedAngles: boolean;
  includeHouseCuspRays: boolean;
  outerTypography: boolean;
  usePrimaryGlyphSize: boolean;
}

/**
 * Keep the directed body source separate from the wheel framework used by its
 * collision solver. Traditional converse moves comparison bodies on the inner
 * track, but their fixed angular/cusp obstacles still belong to the radix.
 */
export function resolveComparisonBodyLayoutPlan<T>(
  presentation: PdRingPresentation,
  primaryChart: T,
  comparisonChart: T,
  context: ComparisonBodyLayoutContext,
): ComparisonBodyLayoutPlan<T> {
  return {
    bodyChart: comparisonChart,
    frameworkChart: presentation.traditionalConverse
      ? primaryChart
      : comparisonChart,
    includeAngles:
      context.anglo &&
      (!presentation.traditionalConverse ||
        context.primaryShowsHouses ||
        context.primaryShowsCusplessAscMcLabels),
    includePositionStacks: presentation.traditionalConverse && context.anglo,
    includeSharedAngles:
      !presentation.traditionalConverse ||
      (!context.primaryShowsHouses && context.primaryShowsCusplessAscMcLabels),
    includeHouseCuspRays: presentation.traditionalConverse
      ? context.primaryShowsHouses
      : context.showOuterHouseCusps,
    outerTypography: !presentation.traditionalConverse,
    usePrimaryGlyphSize:
      !presentation.traditionalConverse && context.restrainedAngloComparison,
  };
}

/** One radius resolver is shared by paint and hit testing. */
export function resolveBodyTrackRadius(
  presentation: PdBodyTrackPresentation,
  radii: BodyTrackRadii,
): number {
  return presentation.track === "outer" ? radii.outer : radii.inner;
}
