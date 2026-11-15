// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  EphemerisBlockStore,
  ephemerisMonthWindow,
  planEphemerisRequests,
} from "../src/lib/chart/ephemeris-block-store";
import {
  monthIndexDays,
  monthIndexStartJd,
  monthIndexYearMonth,
  monthStartJd,
} from "../src/lib/chart/ephemeris-camera";
import { decodeEphemerisBlocks, decodeFloat64Base64 } from "../src/lib/chart/ephemeris-wire";
import type { EphemerisBlocksWire, EphemerisYearStationsWire } from "../src/lib/daemon/client";

const b64 = (values: number[]) => Buffer.from(new Float64Array(values).buffer).toString("base64");
const idx = (year: number, month: number) => year * 12 + month - 1;

/** A daemon twin: planets 0 and 1, longitude = day number, declination = -day. */
function blocksWire(dataKey: string, year: number, month: number, count: number): EphemerisBlocksWire {
  const planetIds = [0, 1];
  const blocks = Array.from({ length: count }, (_, k) => {
    const index = idx(year, month) + k;
    const ym = monthIndexYearMonth(index);
    const days = monthIndexDays(index);
    const startJd = monthIndexStartJd(index);
    const lon = planetIds.flatMap((id) => Array.from({ length: days }, (_, d) => id * 100 + d));
    const decl = lon.map((v) => -v);
    return {
      year: ym.year,
      month: ym.month,
      startJd,
      days,
      longitude: b64(lon),
      declination: b64(decl),
      signEvents: [{ planet: 0, jd: startJd + 3.25, value: 30, targetSign: 1, fromSign: 0, toSign: 1, eventSign: 1, retrograde: false, date: "d" }],
      declinationStations: [{ planet: 1, jd: startJd + 5, value: 0, code: "EQ", date: "d" }],
      lunations: [{ kind: "full", jd: startJd + 9.5, longitude: 10, declination: 2, date: "d", eclipse: "lunar", eclipseLabel: "Lunar eclipse" }],
      outOfBounds: [{ planet: 0, jd: startJd + 1, value: 24 }],
    };
  });
  return { dataKey, planetIds, blocks };
}

type Call = { kind: "blocks"; year: number; month: number; count: number } | { kind: "stations"; year: number };

function fakeDaemon(dataKey = "k1") {
  const calls: Call[] = [];
  const resolvers: Array<() => void> = [];
  const state = { dataKey, auto: true };
  const settle = <T>(make: () => T): Promise<T> =>
    new Promise((resolve) => {
      const run = () => resolve(make());
      if (state.auto) queueMicrotask(run);
      else resolvers.push(run);
    });
  const fetchers = {
    fetchBlocks: (year: number, month: number, count: number) => {
      calls.push({ kind: "blocks", year, month, count });
      const key = state.dataKey;
      return settle(() => blocksWire(key, year, month, count));
    },
    fetchStationYear: (year: number): Promise<EphemerisYearStationsWire> => {
      calls.push({ kind: "stations", year });
      const key = state.dataKey;
      return settle(() => ({ dataKey: key, year, longitude: [{ planet: 0, jd: monthStartJd(year, 6), value: 100, code: "SR", date: "d" }] }));
    },
  };
  return { calls, resolvers, state, fetchers };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("decoder reads little-endian Float64 rows planet-major and keeps every event field", () => {
  expect(Array.from(decodeFloat64Base64(b64([1.5, -2, Math.PI])))).toEqual([1.5, -2, Math.PI]);
  expect(decodeFloat64Base64("").length).toBe(0);
  const [block] = decodeEphemerisBlocks(blocksWire("k", 2026, 2, 1));
  expect(block.monthIndex).toBe(idx(2026, 2));
  expect(block.days).toBe(28);
  expect(block.rows.get(1)?.longitude[0]).toBe(100);
  expect(block.rows.get(1)?.longitude[27]).toBe(127);
  expect(block.rows.get(0)?.declination[5]).toBe(-5);
  expect(block.signEvents[0]).toEqual({
    planet: 0, jd: monthStartJd(2026, 2) + 3.25, value: 30, targetSign: 1, fromSign: 0, toSign: 1, eventSign: 1, retrograde: false, date: "d",
  });
  expect(block.declinationStations[0].code).toBe("EQ");
  expect(block.lunations[0]).toMatchObject({ kind: "full", eclipse: "lunar", eclipseLabel: "Lunar eclipse" });
  expect(block.outOfBounds[0]).toEqual({ planet: 0, jd: monthStartJd(2026, 2) + 1, value: 24 });
  expect(block.bytes).toBeGreaterThan(2 * 28 * 8 * 2);
});

test("month window: visible months plus a margin, wider in the pan direction", () => {
  const view = { startJd: monthStartJd(2026, 3) + 10, endJd: monthStartJd(2026, 7) + 2 };
  const still = ephemerisMonthWindow({ ...view, panDirection: 0 });
  expect(still.visible).toEqual([idx(2026, 3), idx(2026, 4), idx(2026, 5), idx(2026, 6), idx(2026, 7)]);
  // Half the visible months, but at least a year either side.
  expect(still.ahead).toEqual(Array.from({ length: 12 }, (_, k) => idx(2026, 8) + k));
  expect(still.behind).toEqual(Array.from({ length: 12 }, (_, k) => idx(2026, 2) - k));
  const left = ephemerisMonthWindow({ ...view, panDirection: -1 });
  expect(left.visible[0]).toBe(idx(2026, 7));
  expect(left.ahead).toHaveLength(24);
  expect(left.ahead[0]).toBe(idx(2026, 2));
  expect(left.behind).toHaveLength(12);
  expect(left.behind[0]).toBe(idx(2026, 8));
  // A wide view's margin is half its visible months.
  const wide = ephemerisMonthWindow({ startJd: monthStartJd(2020, 1), endJd: monthStartJd(2024, 1), panDirection: 0 });
  expect(wide.ahead).toHaveLength(24);
  expect(ephemerisMonthWindow({ ...view, panDirection: 0 }, 0).ahead).toEqual([]);
  // A view ending exactly on a month start does not need that month.
  const exact = ephemerisMonthWindow({ startJd: monthStartJd(2026, 1), endJd: monthStartJd(2027, 1), panDirection: 0 });
  expect(exact.visible).toHaveLength(12);
});

test("requests batch contiguous missing months up to 24, in priority order", () => {
  const months = Array.from({ length: 60 }, (_, k) => 1000 + k);
  const plan = planEphemerisRequests(
    [
      { kind: "blocks", months: [1003, 1002, 1001] },
      { kind: "blocks", months },
      { kind: "stations", years: [83, 84] },
    ],
    (kind, id) => (kind === "blocks" ? id !== 1010 : id !== 84),
  );
  expect(plan).toEqual([
    { kind: "blocks", startIndex: 1001, count: 3 },
    { kind: "blocks", startIndex: 1000, count: 1 },
    { kind: "blocks", startIndex: 1004, count: 6 },
    { kind: "blocks", startIndex: 1011, count: 24 },
    { kind: "blocks", startIndex: 1035, count: 24 },
    { kind: "blocks", startIndex: 1059, count: 1 },
    { kind: "stations", year: 83 },
  ]);
});

test("loader fetches visible months first, then the pan direction and behind, stations after", async () => {
  const daemon = fakeDaemon();
  daemon.state.auto = false;
  const store = new EphemerisBlockStore(daemon.fetchers, { maxInFlight: 2 });
  store.setDataKey("k1");
  store.setInterest("v", { startJd: monthStartJd(2026, 3), endJd: monthStartJd(2026, 5), panDirection: 1 });
  // Visible first, then the pan-direction margin (two years ahead, in
  // one-year batches), then the visible year's stations.
  expect(daemon.calls).toEqual([
    { kind: "blocks", year: 2026, month: 3, count: 2 },
    { kind: "blocks", year: 2026, month: 5, count: 12 },
  ]);
  daemon.resolvers.shift()?.();
  await flush();
  expect(daemon.calls[2]).toEqual({ kind: "blocks", year: 2027, month: 5, count: 12 });
  daemon.resolvers.shift()?.();
  await flush();
  // Curves behind are as cheap as ahead and gate a reversal: they go before
  // any overlay.
  expect(daemon.calls[3]).toEqual({ kind: "blocks", year: 2025, month: 3, count: 12 });
  daemon.resolvers.shift()?.();
  await flush();
  expect(daemon.calls[4]).toEqual({ kind: "stations", year: 2026 });
  const frame = store.frameData(monthStartJd(2026, 3), monthStartJd(2026, 5));
  expect(frame.blocks.map((b) => b.month)).toEqual([3, 4]);
  expect(store.isResident(monthStartJd(2026, 3), monthStartJd(2026, 5), false)).toBe(true);
  expect(store.isResident(monthStartJd(2026, 3), monthStartJd(2026, 5))).toBe(false);
});

test("a data-key change keeps the old blocks drawable until the new key covers the view", async () => {
  const daemon = fakeDaemon("k1");
  const store = new EphemerisBlockStore(daemon.fetchers, { maxInFlight: 4 });
  const view = { startJd: monthStartJd(2026, 1), endJd: monthStartJd(2026, 3), panDirection: 0 as const };
  store.setInterest("v", view);
  await flush();
  expect(store.dataKey).toBe("k1");
  expect(store.frameData(view.startJd, view.endJd).blocks.every((b) => b.dataKey === "k1")).toBe(true);
  daemon.state.auto = false;
  daemon.state.dataKey = "k2";
  store.setDataKey("k2");
  // Nothing of k2 yet: the old plate stays.
  let frame = store.frameData(view.startJd, view.endJd);
  expect(frame.dataKey).toBe("k1");
  expect(frame.blocks).toHaveLength(2);
  while (daemon.resolvers.length) {
    daemon.resolvers.shift()?.();
    await flush();
  }
  frame = store.frameData(view.startJd, view.endJd);
  expect(frame.dataKey).toBe("k2");
  expect(frame.blocks.every((b) => b.dataKey === "k2")).toBe(true);
});

test("LRU eviction keeps the byte budget and never drops what a view needs", async () => {
  const daemon = fakeDaemon();
  const oneBlock = decodeEphemerisBlocks(blocksWire("k1", 2026, 1, 1))[0].bytes;
  const store = new EphemerisBlockStore(daemon.fetchers, { maxInFlight: 8, byteBudget: oneBlock * 12, marginFraction: 0 });
  store.setDataKey("k1");
  const show = async (year: number, month: number) => {
    store.setInterest("v", { startJd: monthStartJd(year, month), endJd: monthStartJd(year, month + 1), panDirection: 0 });
    await flush();
    store.frameData(monthStartJd(year, month), monthStartJd(year, month + 1));
  };
  for (let month = 1; month <= 12; month++) await show(2020, month);
  await show(2030, 6);
  const stats = store.stats();
  expect(stats.residentBytes).toBeLessThanOrEqual(oneBlock * 12);
  // The view's months are resident; the least recently drawn ones went first.
  expect(store.frameData(monthStartJd(2030, 6), monthStartJd(2030, 7)).blocks).toHaveLength(1);
  expect(store.frameData(monthStartJd(2020, 1), monthStartJd(2020, 2)).blocks).toHaveLength(0);
  expect(store.frameData(monthStartJd(2020, 12), monthStartJd(2021, 1)).blocks).toHaveLength(1);
});

test("a long burst evicts in batches down to a low watermark, never the view", async () => {
  const daemon = fakeDaemon();
  const oneBlock = decodeEphemerisBlocks(blocksWire("k1", 2026, 1, 1))[0].bytes;
  const budget = oneBlock * 40;
  // Every step settles at once here, so each lands with its station year too.
  const store = new EphemerisBlockStore(daemon.fetchers, { maxInFlight: 2, byteBudget: budget, marginFraction: 0, settleMs: 0 });
  store.setDataKey("k1");
  let evictions = 0;
  let previousBlocks = 0;
  for (let step = 0; step < 120; step++) {
    const view = { startJd: monthStartJd(1900 + step, 1), endJd: monthStartJd(1901 + step, 1) };
    store.setInterest("v", { ...view, panDirection: 1 });
    await flush();
    const { blocks, residentBytes } = store.stats();
    if (blocks < previousBlocks) evictions += 1;
    previousBlocks = blocks;
    expect(residentBytes).toBeLessThanOrEqual(budget);
    expect(store.isResident(view.startJd, view.endJd)).toBe(true);
  }
  // Each eviction frees ~15% of the budget (a few years), not one block.
  expect(evictions).toBeLessThan(60);
  expect(evictions).toBeGreaterThan(0);
});

test("landing requests notify listeners at most once per microtask", async () => {
  const daemon = fakeDaemon();
  daemon.state.auto = false;
  const store = new EphemerisBlockStore(daemon.fetchers, { maxInFlight: 3, marginFraction: 0 });
  store.setDataKey("k1");
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });
  store.setInterest("v", { startJd: monthStartJd(2026, 1), endJd: monthStartJd(2027, 1), panDirection: 0 });
  store.setInterest("w", { startJd: monthStartJd(2030, 1), endJd: monthStartJd(2031, 1), panDirection: 0 });
  // An unchanged window does not plan or start anything.
  const started = daemon.calls.length;
  store.setInterest("v", { startJd: monthStartJd(2026, 1) + 0.5, endJd: monthStartJd(2027, 1), panDirection: 0 });
  expect(daemon.calls.length).toBe(started);
  while (daemon.resolvers.length) daemon.resolvers.shift()?.();
  await flush();
  expect(calls).toBe(1);
});

test("a burst never stacks hidden daemon work: passed months finish, the latest range goes next", async () => {
  const daemon = fakeDaemon();
  daemon.state.auto = false;
  const aborted: string[] = [];
  const store = new EphemerisBlockStore(
    {
      fetchBlocks: (year, month, count, signal) => {
        signal.addEventListener("abort", () => aborted.push(`${year}-${month}`));
        return daemon.fetchers.fetchBlocks(year, month, count);
      },
      fetchStationYear: (year) => daemon.fetchers.fetchStationYear(year),
    },
    { maxInFlight: 1, marginFraction: 0 },
  );
  store.setDataKey("k1");
  // A held ↑ burst: the camera's destination moves a year per key repeat.
  for (let year = 2026; year <= 2034; year++) {
    store.setInterest("v", { startJd: monthStartJd(year, 1), endJd: monthStartJd(year + 1, 1), panDirection: 1 });
  }
  // Only the first request reached the daemon and nothing was aborted, so no
  // abandoned work queues in front of the range the burst stops on.
  expect(aborted).toEqual([]);
  expect(daemon.calls.filter((c) => c.kind === "blocks")).toEqual([{ kind: "blocks", year: 2026, month: 1, count: 12 }]);
  daemon.resolvers.shift()?.();
  await flush();
  expect(daemon.calls.at(-1)).toEqual({ kind: "blocks", year: 2034, month: 1, count: 12 });
  expect(store.frameData(monthStartJd(2026, 1), monthStartJd(2027, 1)).blocks).toHaveLength(12);
});

test("a data-key change aborts the old key's requests; failures retry later", async () => {
  const daemon = fakeDaemon();
  daemon.state.auto = false;
  const aborted: string[] = [];
  const store = new EphemerisBlockStore(
    {
      fetchBlocks: (year, month, count, signal) => {
        signal.addEventListener("abort", () => aborted.push(`${year}-${month}`));
        return daemon.fetchers.fetchBlocks(year, month, count);
      },
      fetchStationYear: (year) => daemon.fetchers.fetchStationYear(year),
    },
    { maxInFlight: 1, marginFraction: 0 },
  );
  store.setDataKey("k1");
  store.setInterest("v", { startJd: monthStartJd(2026, 1), endJd: monthStartJd(2026, 2), panDirection: 0 });
  store.setDataKey("k2");
  expect(aborted).toEqual(["2026-1"]);
  expect(daemon.calls.at(-1)).toEqual({ kind: "blocks", year: 2026, month: 1, count: 1 });

  let failures = 0;
  const failing = new EphemerisBlockStore(
    {
      fetchBlocks: () => {
        failures += 1;
        return Promise.reject(new Error("boom"));
      },
      fetchStationYear: () => Promise.reject(new Error("boom")),
    },
    { marginFraction: 0 },
  );
  failing.setDataKey("k1");
  failing.setInterest("v", { startJd: monthStartJd(2026, 1), endJd: monthStartJd(2026, 2), panDirection: 0 });
  await flush();
  expect(failing.error).toBe("boom");
  const after = failures;
  failing.setInterest("v", { startJd: monthStartJd(2026, 1), endJd: monthStartJd(2026, 2), panDirection: 1 });
  await flush();
  // Backed-off months are not re-requested at once.
  expect(failures).toBe(after);
});

/** Year-layer wire of the fake daemon: one row per month of the year. */
const layerRowsOf = (layer: string, year: number) =>
  Array.from({ length: 12 }, (_, m) => ({ layer, year, jd: monthStartJd(year, m + 1) + 10 }));

/** A daemon twin with the split routes: curves (/series), marks
 * (/blocks?series=false), stations and two year layers, each request timed
 * by its measured cold cost per month or year and run one at a time (the
 * daemon computes under one interpreter lock), on a virtual clock. */
function splitDaemon() {
  const clock = { now: 0 };
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const virtualTimers = {
    set: (run: () => void, ms: number) => {
      const timer = { at: clock.now + ms, run, live: true };
      timers.push(timer);
      return timer;
    },
    clear: (handle: unknown) => {
      (handle as { live: boolean }).live = false;
    },
  };
  const queue: Array<{ start: number; cost: number; run: () => void }> = [];
  let busyUntil = 0;
  const log: Array<{ kind: string; at: number; done?: number }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const enqueue = <T>(kind: string, cost: number, make: () => T): Promise<T> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const entry: { kind: string; at: number; done?: number } = { kind, at: clock.now };
    log.push(entry);
    return new Promise((resolve) => {
      queue.push({
        start: clock.now,
        cost,
        run: () => {
          inFlight -= 1;
          entry.done = clock.now;
          resolve(make());
        },
      });
    });
  };
  const curvesOnly = (wire: EphemerisBlocksWire): EphemerisBlocksWire => ({
    ...wire,
    blocks: wire.blocks.map((b) => {
      const { year, month, startJd, days, longitude, declination } = b as Record<string, unknown>;
      return { year, month, startJd, days, longitude, declination };
    }),
  });
  const marksOnly = (wire: EphemerisBlocksWire): EphemerisBlocksWire => ({
    ...wire,
    blocks: wire.blocks.map((b) => {
      const { longitude: _l, declination: _d, ...rest } = b as Record<string, unknown>;
      return rest;
    }),
  });
  const fetchers = {
    fetchSeries: (year: number, month: number, count: number) =>
      enqueue("curves", 2.5 * count + 4, () => curvesOnly(blocksWire("k1", year, month, count))),
    fetchBlocks: (year: number, month: number, count: number) =>
      enqueue("marks", 7 * count + 4, () => marksOnly(blocksWire("k1", year, month, count))),
    fetchStationYear: (year: number): Promise<EphemerisYearStationsWire> =>
      enqueue("stations", 33, () => ({ dataKey: "k1", year, longitude: [] })),
  };
  const layerFetch = (layer: string, cost: number) => (year: number) =>
    enqueue(layer, cost, () => layerRowsOf(layer, year));
  const flushTasks = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  /** Advance the virtual clock by `ms`: queued work finishes in order (one
   * at a time from when it could start) and due timers fire. */
  const advance = async (ms: number) => {
    const end = clock.now + ms;
    while (true) {
      await flushTasks();
      const next = queue[0];
      const finishAt = next ? Math.max(busyUntil, next.start) + next.cost : Infinity;
      const timer = timers.filter((t) => t.live).sort((a, b) => a.at - b.at)[0];
      const timerAt = timer ? timer.at : Infinity;
      const at = Math.min(finishAt, timerAt);
      if (at > end) break;
      clock.now = Math.max(clock.now, at);
      if (timerAt <= finishAt && timer) {
        timer.live = false;
        timer.run();
      } else if (next) {
        queue.shift();
        busyUntil = finishAt;
        next.run();
      }
    }
    clock.now = end;
    await flushTasks();
  };
  return { clock, fetchers, layerFetch, advance, log, virtualTimers, stats: () => ({ inFlight, maxInFlight }) };
}

test("curves load first; marks, stations and layers wait for the range to hold still", async () => {
  const daemon = splitDaemon();
  const store = new EphemerisBlockStore(daemon.fetchers, { now: () => daemon.clock.now, timers: daemon.virtualTimers });
  store.defineYearLayer("contacts", { fetchYear: daemon.layerFetch("contacts", 25), decode: (w) => w as unknown[] });
  store.setLayerKey("contacts", "k1");
  store.setDataKey("k1");
  const at = (year: number) => ({ startJd: monthStartJd(year, 1), endJd: monthStartJd(year, 4), panDirection: 1 as const, layers: ["contacts"] });
  store.setInterest("v", at(2026));
  await daemon.advance(1);
  // A held arrow: the range moves every 40 ms.
  for (let year = 2027; year <= 2030; year++) {
    store.setInterest("v", at(year));
    await daemon.advance(40);
  }
  const moving = daemon.log.filter((entry) => entry.at > 1);
  expect(moving.length).toBeGreaterThan(0);
  expect(moving.every((entry) => entry.kind === "curves")).toBe(true);
  // Released: after the settle the overlays of the range follow.
  await daemon.advance(600);
  const view = at(2030);
  expect(store.isResident(view.startJd, view.endJd, false)).toBe(true);
  expect(store.isResident(view.startJd, view.endJd, true, ["contacts"])).toBe(true);
  const frame = store.frameData(view.startJd, view.endJd);
  expect(frame.blocks.every((block) => block.marks && block.lunations.length === 1)).toBe(true);
  expect(store.layerRows("contacts", [2030])).toHaveLength(12);
  expect(store.layerRows("contacts", [2030])).toBe(store.layerRows("contacts", [2030]));
  // A layer without a key holds nothing up.
  store.setLayerKey("contacts", "");
  expect(store.isResident(view.startJd, view.endJd, false, ["contacts"])).toBe(true);
});

test("a held arrow at ten years keeps pace with key repeat and fills in when released", async () => {
  const daemon = splitDaemon();
  const store = new EphemerisBlockStore(daemon.fetchers, { now: () => daemon.clock.now, timers: daemon.virtualTimers });
  store.defineYearLayer("contacts", { fetchYear: daemon.layerFetch("contacts", 25), decode: (w) => w as unknown[] });
  store.defineYearLayer("radix:doc", { fetchYear: daemon.layerFetch("radix:doc", 90), decode: (w) => w as unknown[] });
  store.setLayerKey("contacts", "k1");
  store.setLayerKey("radix:doc", "k1");
  store.setDataKey("k1");
  const layers = ["contacts", "radix:doc"];
  const span = (year: number) => ({ startJd: monthStartJd(year, 1), endJd: monthStartJd(year + 10, 1) });
  // Open at 1900 and let it settle completely.
  store.setInterest("v", { ...span(1900), panDirection: 0, layers });
  await daemon.advance(8000);
  expect(store.isResident(span(1900).startJd, span(1900).endJd, true, layers)).toBe(true);
  // The view's step rule: a key repeat every 33 ms; a step lands once its
  // curves are resident, repeats meanwhile are dropped.
  const KEY_REPEAT_MS = 33;
  let year = 1900;
  let landed = 0;
  let pending: number | null = null;
  const waits: number[] = [];
  let pendingSince = 0;
  for (let tick = 0; tick < 300; tick++) {
    if (pending == null) {
      pending = year + 1;
      pendingSince = daemon.clock.now;
    }
    const target = span(pending);
    store.setInterest("v", { ...target, panDirection: 1, layers });
    if (store.isResident(target.startJd, target.endJd, false)) {
      waits.push(daemon.clock.now - pendingSince);
      year = pending;
      pending = null;
      landed += 1;
    }
    await daemon.advance(KEY_REPEAT_MS);
  }
  // Ten seconds held: every repeat lands (curves are ~34 ms a year cold,
  // prefetched ahead), and no step ever waits more than a repeat or two.
  expect(landed).toBeGreaterThan(250);
  expect(Math.max(...waits)).toBeLessThanOrEqual(2 * KEY_REPEAT_MS);
  expect(daemon.stats().maxInFlight).toBeLessThanOrEqual(3);
  // Released: the final plate fills in completely.
  await daemon.advance(8000);
  const final = span(year);
  expect(store.isResident(final.startJd, final.endJd, true, layers)).toBe(true);
  for (const layer of layers) {
    const rows = store.layerRows(layer, Array.from({ length: 10 }, (_, k) => year + k));
    expect(rows).toHaveLength(120);
  }
  // Going back over the burst lands at once (curves are pinned or cached).
  const back = span(year - 5);
  store.setInterest("v", { ...back, panDirection: -1, layers });
  expect(store.isResident(back.startJd, back.endJd, false)).toBe(true);
});
