// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { eclipseVirtualWindow } from "../src/components/workshell/eclipses-view";

const staleLargeViewport = { scrollTop: 10_000, height: 320, headerHeight: 30 };

test("finite eclipse series renders every row despite stale timeline scroll", () => {
  expect(eclipseVirtualWindow(80, 51, 28, staleLargeViewport, false)).toEqual({
    startIndex: 0,
    endIndex: 80,
    paddingTop: 0,
    paddingBottom: 0,
  });
});

test("ordinary eclipse virtualization remains total for stale scroll geometry", () => {
  const window = eclipseVirtualWindow(80, 51, 28, staleLargeViewport, true);

  expect(window.startIndex).toBeGreaterThanOrEqual(0);
  expect(window.endIndex).toBeGreaterThanOrEqual(window.startIndex);
  expect(window.endIndex).toBeLessThanOrEqual(80);
  expect(window.paddingTop).toBeGreaterThanOrEqual(0);
  expect(window.paddingBottom).toBeGreaterThanOrEqual(0);
  expect(window).toEqual({
    startIndex: 51,
    endIndex: 80,
    paddingTop: 1428,
    paddingBottom: 0,
  });
});
