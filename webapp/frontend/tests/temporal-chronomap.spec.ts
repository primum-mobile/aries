// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  layoutTemporalChronomapBands,
  nearestSelectableTemporalConcurrence,
  panTemporalChronomapViewport,
  temporalChronomapCoverageSegments,
  temporalChronomapJdAtRatio,
  temporalChronomapViewportForPreset,
  visibleTemporalChronomapTicks,
  zoomTemporalChronomapViewport,
  type TemporalChronomapViewport,
} from "../src/components/workshell/temporal-chronomap";

const world: TemporalChronomapViewport = { startJdUt: 0, endJdUt: 100 };

test("life is the full horizon and finer presets stay centered on the JD focus", () => {
  expect(temporalChronomapViewportForPreset("life", world, 60)).toEqual(world);
  expect(temporalChronomapViewportForPreset("day", world, 60)).toEqual({
    startJdUt: 59.5,
    endJdUt: 60.5,
  });
  expect(temporalChronomapViewportForPreset("decade", world, 60)).toEqual(world);
});

test("wheel zoom preserves the pointer JD and pan clamps to the life horizon", () => {
  const zoomed = zoomTemporalChronomapViewport(world, world, 25, 0.5);
  expect(zoomed).toEqual({ startJdUt: 12.5, endJdUt: 62.5 });
  expect(temporalChronomapJdAtRatio(zoomed, 0.25)).toBe(25);

  expect(panTemporalChronomapViewport(zoomed, world, -40)).toEqual({
    startJdUt: 0,
    endJdUt: 50,
  });
  expect(panTemporalChronomapViewport(zoomed, world, 80)).toEqual({
    startJdUt: 50,
    endJdUt: 100,
  });
});

test("coverage gaps remain explicitly unknown and completed evidence wins overlap", () => {
  expect(temporalChronomapCoverageSegments(world, [
    { startJdUt: 10, endJdUt: 20, status: "complete" },
    { startJdUt: 15, endJdUt: 30, status: "pending" },
  ])).toEqual([
    { startJdUt: 0, endJdUt: 10, status: "unknown" },
    { startJdUt: 10, endJdUt: 20, status: "complete" },
    { startJdUt: 20, endJdUt: 30, status: "pending" },
    { startJdUt: 30, endJdUt: 100, status: "unknown" },
  ]);

  expect(temporalChronomapCoverageSegments(world, [])).toEqual([
    { startJdUt: 0, endJdUt: 100, status: "unknown" },
  ]);
});

test("overlapping activation bands receive stable internal slots", () => {
  const positioned = layoutTemporalChronomapBands([
    { id: "a", label: "A", startJdUt: 0, endJdUt: 10 },
    { id: "b", label: "B", startJdUt: 5, endJdUt: 8 },
    { id: "c", label: "C", startJdUt: 10, endJdUt: 20 },
  ], world);
  expect(positioned.map(({ band, slot, slotCount }) => [band.id, slot, slotCount])).toEqual([
    ["a", 0, 2],
    ["b", 1, 2],
    ["c", 0, 2],
  ]);
});

test("tick selection uses only daemon labels and canonical JDs", () => {
  expect(visibleTemporalChronomapTicks([
    { jdUt: 90, label: "late" },
    { jdUt: Number.NaN, label: "invalid" },
    { jdUt: 20, label: "early" },
    { jdUt: 120, label: "outside" },
  ], { startJdUt: 10, endJdUt: 100 })).toEqual([
    { jdUt: 20, label: "early" },
    { jdUt: 90, label: "late" },
  ]);
});

test("keyboard concurrence selection chooses the nearest exact horizon only", () => {
  const viewport = { startJdUt: 10, endJdUt: 20 };
  const selected = nearestSelectableTemporalConcurrence([
    {
      id: "aggregate",
      startJdUt: 14,
      endJdUt: 15,
      focusJdUt: 14.5,
      label: "aggregate",
      laneIds: ["lane-1", "lane-2"],
      planetId: 3,
      selectable: false,
    },
    {
      id: "far",
      startJdUt: 18,
      endJdUt: 19,
      focusJdUt: 18.5,
      label: "far",
      laneIds: ["lane-1", "lane-2"],
      planetId: 3,
    },
    {
      id: "near",
      startJdUt: 15,
      endJdUt: 16,
      focusJdUt: 15.5,
      label: "near",
      laneIds: ["lane-1", "lane-2"],
      planetId: 3,
    },
  ], viewport, 15);

  expect(selected?.id).toBe("near");
});
