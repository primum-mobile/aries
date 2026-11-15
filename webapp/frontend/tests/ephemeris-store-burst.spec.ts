// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Held-↑ burst against the Graphic Ephemeris block store (not part of
// test:unit: it is a timing bench). 400 years of one-year steps against an
// instant fake daemon, with a byte budget of ~140 years (the real 24 MB) so the store spends
// most of the burst full and evicting. Per-step store work must stay flat:
// the last 50 steps may not cost much more than the first 50. Run:
//   npx playwright test tests/ephemeris-store-burst.spec.ts --reporter=line

import { expect, test } from "@playwright/test";

import { EphemerisBlockStore } from "../src/lib/chart/ephemeris-block-store";
import { monthIndexDays, monthIndexStartJd, monthIndexYearMonth, monthStartJd } from "../src/lib/chart/ephemeris-camera";
import type { EphemerisBlocksWire, EphemerisYearStationsWire } from "../src/lib/daemon/client";

const b64 = (values: Float64Array) => Buffer.from(values.buffer).toString("base64");
const idx = (year: number, month: number) => year * 12 + month - 1;

// Wire strings are precomputed per month length, so the fake daemon costs
// the same at every step and the timing is the store's own.
const wireRows = new Map<number, string>();
function rowsOf(days: number): string {
  let row = wireRows.get(days);
  if (!row) {
    row = b64(new Float64Array(2 * days).map((_, k) => k));
    wireRows.set(days, row);
  }
  return row;
}

function blocksWire(dataKey: string, year: number, month: number, count: number): EphemerisBlocksWire {
  const blocks = Array.from({ length: count }, (_, k) => {
    const index = idx(year, month) + k;
    const ym = monthIndexYearMonth(index);
    const days = monthIndexDays(index);
    const startJd = monthIndexStartJd(index);
    return {
      year: ym.year,
      month: ym.month,
      startJd,
      days,
      longitude: rowsOf(days),
      declination: rowsOf(days),
      signEvents: [],
      declinationStations: [],
      lunations: [],
      outOfBounds: [],
    };
  });
  return { dataKey, planetIds: [0, 1], blocks };
}

const flushOnce = () => Promise.resolve();

test("a 400-year held burst keeps per-step store work flat under eviction", async () => {
  let fetchedBlocks = 0;
  const fetchers = {
    fetchBlocks: (year: number, month: number, count: number) => {
      fetchedBlocks += count;
      return Promise.resolve(blocksWire("k1", year, month, count));
    },
    fetchStationYear: (year: number): Promise<EphemerisYearStationsWire> =>
      Promise.resolve({ dataKey: "k1", year, longitude: [{ planet: 0, jd: monthStartJd(year, 6), value: 1, code: "SR", date: "d" }] }),
  };
  const probe = new EphemerisBlockStore(fetchers);
  probe.setDataKey("k1");
  probe.setInterest("v", { startJd: monthStartJd(2000, 1), endJd: monthStartJd(2000, 2), panDirection: 0 });
  for (let i = 0; i < 50; i++) await flushOnce();
  const perYear = probe.stats().residentBytes / Math.max(1, probe.stats().blocks / 12);
  const budget = Math.round(perYear * 140);

  const store = new EphemerisBlockStore(fetchers, { byteBudget: budget });
  store.setDataKey("k1");
  let notifications = 0;
  let pending: { startJd: number; endJd: number } | null = null;
  let landed = false;
  // The view's subscribe callback: a pending step lands once resident.
  store.subscribe(() => {
    notifications += 1;
    if (pending && store.isResident(pending.startJd, pending.endJd, false)) landed = true;
    store.stats();
  });
  const frame = (view: { startJd: number; endJd: number }) => {
    store.setInterest("v", { ...view, panDirection: 1 });
    store.frameData(view.startJd, view.endJd);
    store.isResident(view.startJd, view.endJd, false);
  };

  const STEPS = 400;
  const stepMs: number[] = [];
  let maxResident = 0;
  let visibleEvicted = 0;
  for (let step = 0; step < STEPS; step++) {
    const year = 1600 + step;
    const view = { startJd: monthStartJd(year, 1), endJd: monthStartJd(year + 1, 1) };
    const started = performance.now();
    landed = store.isResident(view.startJd, view.endJd, false);
    pending = landed ? null : view;
    // Frames while the step waits for its months, then a few easing frames.
    let frames = 0;
    while (!landed && frames < 400) {
      frame(view);
      await flushOnce();
      frames += 1;
    }
    pending = null;
    for (let k = 0; k < 4; k++) {
      frame(view);
      await flushOnce();
    }
    stepMs.push(performance.now() - started);
    expect(landed).toBe(true);
    if (!store.isResident(view.startJd, view.endJd, false)) visibleEvicted += 1;
    maxResident = Math.max(maxResident, store.stats().residentBytes);
  }
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const first = sum(stepMs.slice(0, 50)) / 50;
  const last = sum(stepMs.slice(-50)) / 50;
  const evictedBlocks = fetchedBlocks - store.stats().blocks;
  console.log(
    `burst: first50 ${first.toFixed(3)} ms/step, last50 ${last.toFixed(3)} ms/step, ratio ${(last / first).toFixed(2)}, ` +
      `resident ${store.stats().blocks} blocks / max ${(maxResident / 1024).toFixed(0)} KiB of ${(budget / 1024).toFixed(0)} KiB, ` +
      `evicted ${evictedBlocks} blocks, notifications ${notifications}`,
  );
  expect(visibleEvicted).toBe(0);
  expect(maxResident).toBeLessThanOrEqual(budget);
  expect(evictedBlocks).toBeGreaterThan(2000);
  expect(last / first).toBeLessThan(2);
});
