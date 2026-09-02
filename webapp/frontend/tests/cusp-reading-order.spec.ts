// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { readingOrderTangent } from "../src/lib/chart/draw-chart";

test("Anglo cusp runs advance left-to-right in both wheel hemispheres", () => {
  const upper = readingOrderTangent(0.6, -0.8);
  const lower = readingOrderTangent(0.6, 0.8);

  expect(upper[0]).toBeGreaterThan(0);
  expect(lower[0]).toBeGreaterThan(0);
  expect(upper).toEqual([0.8, 0.6]);
  expect(lower).toEqual([0.8, -0.6]);
});
