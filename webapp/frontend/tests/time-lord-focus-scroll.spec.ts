// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  activePeriodScrollTop,
  deepestVisibleCurrentRowId,
} from "../src/components/workshell/time-lord-table-view";

test("only the deepest visible current period is selected for highlighting", () => {
  const currentIds = ["major", "sub", "minor"];
  expect(deepestVisibleCurrentRowId(currentIds, [
    { id: "major" }, { id: "sub" }, { id: "minor" },
  ])).toBe("minor");
  expect(deepestVisibleCurrentRowId(currentIds, [
    { id: "major" }, { id: "sub" },
  ])).toBe("sub");
});

test("active period sits one quarter down when its major period remains visible", () => {
  expect(activePeriodScrollTop({ focusIndex: 30, majorIndex: 27, rowHeight: 28, viewportHeight: 336 }))
    .toBe(756);
});

test("major period stays in view when the normal anchor would scroll past it", () => {
  expect(activePeriodScrollTop({ focusIndex: 10, majorIndex: 3, rowHeight: 28, viewportHeight: 336 }))
    .toBe(84);
});

test("deepest active row remains visible when expanded periods exceed the viewport", () => {
  expect(activePeriodScrollTop({ focusIndex: 30, majorIndex: 10, rowHeight: 28, viewportHeight: 336 }))
    .toBe(532);
});
