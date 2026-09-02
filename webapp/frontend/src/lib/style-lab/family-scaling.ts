// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sizing a family without flattening it.
 *
 * A family row stands for one reading — a position's degree, sign and minute —
 * whose parts are sized against each other. Fanning a size edit out by writing
 * the same number to every member is not "make this bigger", it is "throw the
 * proportion away": the sign that was deliberately smaller than its degree ends
 * up the same size as it, and the reading the family exists to keep together is
 * the thing the edit destroys.
 *
 * Scaling by the ratio the user actually applied moves the whole group and
 * leaves every member's share of it intact. Colour is the opposite case and
 * does not belong here: one shared colour across a reading is exactly what a
 * family colour edit means.
 */

import type { ChartStyleTokenBounds } from "@/stores/chart-style-editor-store";

export type FamilyNumericBaseline = Readonly<{
  /** What the member is worth before this gesture. */
  value: number;
  bounds?: ChartStyleTokenBounds;
}>;

/**
 * The per-member values a family size edit should write.
 *
 * Returns null when there is no ratio to take — no anchor among the baselines,
 * or an anchor of zero, which every scale factor maps back to zero. The caller
 * then falls back to the ordinary shared write rather than silently doing
 * nothing.
 */
export function scaledFamilyTargets(
  baselines: Readonly<Record<string, FamilyNumericBaseline>>,
  activeSemanticId: string,
  nextValue: number,
): Record<string, number> | null {
  const anchor = baselines[activeSemanticId]?.value;
  if (anchor == null || !Number.isFinite(anchor) || anchor === 0) return null;
  const ratio = nextValue / anchor;
  if (!Number.isFinite(ratio)) return null;
  const targets: Record<string, number> = {};
  for (const [semanticId, baseline] of Object.entries(baselines)) {
    if (!Number.isFinite(baseline.value)) continue;
    // The edited control lands on exactly what the user typed or dragged to;
    // only its siblings are computed. Putting the anchor through the ratio as
    // well would let the field disagree with itself.
    const scaled = semanticId === activeSemanticId
      ? nextValue
      : baseline.value * ratio;
    targets[semanticId] = baseline.bounds
      ? Math.min(baseline.bounds.max, Math.max(baseline.bounds.min, scaled))
      : scaled;
  }
  return targets;
}
