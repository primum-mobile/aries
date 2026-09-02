// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import type {
  TemporalConcurrenceGroup,
  TemporalMapInstant,
  TemporalMapTilesResult,
} from "../src/lib/daemon/client";
import {
  buildChronomapConcurrences,
  fetchTemporalMapGroupPages,
  shouldLoadExactTemporalGroups,
  shouldClearPinnedTemporalGroup,
  temporalLaneFocusJdUt,
  temporalMapTickJds,
  temporalMapTicksFromInstants,
} from "../src/components/workshell/temporal-confluence-view";

function instant(jdUt: number, ageYears: number): TemporalMapInstant {
  return {
    jdUt,
    year: 2000,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    civilDate: "daemon-civil-date",
    civilDatetime: "daemon-civil-datetime",
    canonicalQueryDatetime: "daemon-civil-datetime",
    dateLabel: "daemon date",
    datetimeLabel: "daemon datetime",
    ageYears,
    ageYearsInt: Math.floor(ageYears),
    ageLabel: `age ${Math.floor(ageYears)}`,
  };
}

test("a concurrence tethers each canonical list by JD without browser date conversion", () => {
  const group: TemporalConcurrenceGroup = {
    groupId: "venus",
    planetId: 3,
    startJdUt: 50,
    endJdUt: 51,
    focusJdUt: 50.5,
    focusDatetime: null,
    laneCount: 2,
    participants: [{
      laneId: "lane-1",
      sourceId: "transits",
      rowId: "venus-return",
      activationId: "return",
      pointId: "planet:venus",
      planetId: 3,
      role: "actor",
      basis: "orb",
      rowAnchorJdUt: 80,
    }],
  };

  expect(temporalLaneFocusJdUt(group, "lane-1", group.focusJdUt)).toBe(80);
  expect(temporalLaneFocusJdUt(group, "lane-2", group.focusJdUt)).toBe(50.5);
});

test("map ticks span the selected JD camera and render daemon labels", () => {
  const viewport = { startJdUt: 0, endJdUt: 6 };
  expect(temporalMapTickJds(viewport, 4)).toEqual([0, 2, 4, 6]);
  expect(temporalMapTicksFromInstants(
    [instant(0, 0), instant(6, 0.02)],
    viewport,
  ).map((tick) => tick.label)).toEqual(["daemon date", "daemon date"]);

  const dayViewport = { startJdUt: 0, endJdUt: 1 };
  expect(temporalMapTicksFromInstants(
    [instant(0, 0), instant(1, 0.003)],
    dayViewport,
  ).map((tick) => tick.label)).toEqual(["daemon datetime", "daemon datetime"]);
});

test("exact groups begin only at the 45-day drill boundary", () => {
  expect(shouldLoadExactTemporalGroups({ startJdUt: 0, endJdUt: 45 })).toBe(true);
  expect(shouldLoadExactTemporalGroups({ startJdUt: 0, endJdUt: 45.000001 })).toBe(false);
});

test("exact pagination restarts when progressive evidence changes revision", async () => {
  const group = (groupId: string, focusJdUt: number): TemporalConcurrenceGroup => ({
    groupId,
    planetId: 3,
    startJdUt: focusJdUt,
    endJdUt: focusJdUt + 0.1,
    focusJdUt,
    focusDatetime: null,
    laneCount: 2,
    participants: [],
  });
  const pages = [
    { revision: 1, offset: 0, nextOffset: 1, groups: [group("a", 1)] },
    { revision: 2, offset: 1, nextOffset: null, groups: [group("b", 2)] },
    { revision: 2, offset: 0, nextOffset: 1, groups: [group("a", 1)] },
    { revision: 2, offset: 1, nextOffset: null, groups: [group("b", 2)] },
  ].map((page) => ({
    token: "map",
    generation: 1,
    startJdUt: 0,
    endJdUt: 10,
    minimumLanes: 2,
    total: 2,
    coverage: [],
    complete: true,
    ...page,
  }));
  let callCount = 0;
  const result = await fetchTemporalMapGroupPages(
    "map",
    { startJdUt: 0, endJdUt: 10 },
    new AbortController().signal,
    async () => pages[callCount++],
  );

  expect(callCount).toBe(4);
  expect(result?.groups.map((item) => item.groupId)).toEqual(["a", "b"]);
  expect(result?.revision).toBe(2);
});

test("an obsolete pin clears only when exact complete coverage proves absence", () => {
  const pinned: TemporalConcurrenceGroup = {
    groupId: "pinned",
    planetId: 3,
    startJdUt: 5,
    endJdUt: 6,
    focusJdUt: 5.5,
    focusDatetime: null,
    laneCount: 2,
    participants: [],
  };
  const result = {
    token: "map",
    generation: 1,
    revision: 2,
    startJdUt: 0,
    endJdUt: 10,
    minimumLanes: 2,
    groups: [],
    total: 0,
    offset: 0,
    nextOffset: null,
    coverage: [],
    complete: true,
  };

  expect(shouldClearPinnedTemporalGroup(pinned, result, { startJdUt: 0, endJdUt: 10 })).toBe(true);
  expect(shouldClearPinnedTemporalGroup(
    pinned,
    { ...result, complete: false },
    { startJdUt: 0, endJdUt: 10 },
  )).toBe(false);
  expect(shouldClearPinnedTemporalGroup(
    pinned,
    result,
    { startJdUt: 6, endJdUt: 10 },
  )).toBe(false);
  expect(shouldClearPinnedTemporalGroup(
    pinned,
    { ...result, groups: [pinned] },
    { startJdUt: 0, endJdUt: 10 },
  )).toBe(false);
});

test("macro horizons preserve each planet and exact lane mask", () => {
  const tiles: TemporalMapTilesResult = {
    token: "map",
    generation: 1,
    revision: 1,
    startJdUt: 0,
    endJdUt: 100,
    level: 0,
    binCount: 1,
    binDays: 100,
    lanes: [],
    bins: [{
      index: 0,
      startJdUt: 0,
      endJdUt: 100,
      groupCount: 2,
      maxLaneCount: 2,
      laneMask: 0b1111,
      planetIds: [3, 4],
      planetSummaries: [
        { planetId: 3, laneMask: 0b0011, groupCount: 1, maxLaneCount: 2 },
        { planetId: 4, laneMask: 0b1100, groupCount: 1, maxLaneCount: 2 },
      ],
    }],
    coverage: [],
    complete: true,
  };

  expect(buildChronomapConcurrences([], tiles, "Correlation").map((item) => ({
    planetId: item.planetId,
    laneIds: item.laneIds,
  }))).toEqual([
    { planetId: 3, laneIds: ["lane-1", "lane-2"] },
    { planetId: 4, laneIds: ["lane-3", "lane-4"] },
  ]);
});
