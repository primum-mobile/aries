// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { resolveChartPaintTarget, WHEEL_RIM_LIMIT_DEFAULT } from "../src/lib/chart/outer-glyph-lane";

/**
 * The wheel's largest size is a proportion of its pane: the rim, the zodiac's outer
 * edge, stays within 0.843 of half the pane height and 0.844 of half the pane
 * width. Anglo-family rims sit at 0.895 of the half chart side.
 */
const ANGLO_RIM = 0.895;
const limit = { rimRadiusScale: ANGLO_RIM, ...WHEEL_RIM_LIMIT_DEFAULT };
const rim = (side: number) => side / 2 * ANGLO_RIM;

test("a height-limited pane caps the rim at 0.843 of half its height", () => {
  // Full-width chart pane, no left sidebar (CSS px).
  const { side } = resolveChartPaintTarget(1045, 917, 1, 0, false, "center", 1, limit);
  expect(rim(side) / (917 / 2)).toBeCloseTo(0.843, 3);
});

test("a width-limited pane caps the rim at 0.844 of half its width", () => {
  // Half-width table pane: the width decides.
  const { side } = resolveChartPaintTarget(756, 917, 1, 0, false, "center", 1, limit);
  expect(rim(side) / (756 / 2)).toBeCloseTo(0.844, 6);
});

test("the cap follows the wheel's own rim, so smaller rims are not shrunk", () => {
  // Classic rim at 0.83 of the half side already sits inside both caps.
  const { side } = resolveChartPaintTarget(1045, 917, 1, 0, false, "center", 1, { ...limit, rimRadiusScale: 0.83 });
  expect(side).toBe(917);
});

test("outer-ring envelopes and the cap combine as the smaller wheel", () => {
  const capped = resolveChartPaintTarget(1045, 917, 1.1, 0, false, "center", 1, limit).side;
  const envelopeOnly = resolveChartPaintTarget(1045, 917, 1.1, 0, false, "center", 1).side;
  expect(capped).toBeCloseTo(Math.min(envelopeOnly, 917 * 0.843 / ANGLO_RIM), 6);
});

test("no limit leaves the fit unchanged", () => {
  expect(resolveChartPaintTarget(1045, 917, 1).side).toBe(917);
});
