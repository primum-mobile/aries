// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris block store: the one loader for everything time-indexed
// the plate draws. Decoded calendar-month blocks keyed by (dataKey, month),
// one longitude-station layer per calendar year, and registered year layers
// (planet contacts, each radix's crossings) keyed by their own layer key.
// Views declare the time range they show (where a step is heading) and the
// year layers they draw. Two tiers: curves (the month series) always load
// first, heading then ahead then behind, and gate steps; overlays (each
// month's marks, station years, year layers) load once the range holds
// still. Contiguous months batch into one request, a few requests are in
// flight across every kind (overlays never take the last slot), and an LRU
// byte budget evicts what no view needs. Paint never waits: it draws
// whatever is resident and repaints when data lands.
// After a data-key change the old blocks stay drawable until the new key
// covers the visible range: one loader for the plate.

import type { EphemerisBlocksWire, EphemerisYearStationsWire } from "@/lib/daemon/client";

import { monthIndexOfJd, monthIndexYearMonth } from "./ephemeris-camera";
import {
  decodeEphemerisBlocks,
  decodeEphemerisStationYear,
  mergeEphemerisMarks,
  type EphemerisBlock,
  type EphemerisStationYear,
} from "./ephemeris-wire";

export type EphemerisBlockFetchers = Readonly<{
  /** Full month blocks, or (with `fetchSeries`) each month's marks alone. */
  fetchBlocks: (year: number, month: number, count: number, signal: AbortSignal) => Promise<EphemerisBlocksWire>;
  fetchStationYear: (year: number, signal: AbortSignal) => Promise<EphemerisYearStationsWire>;
  /** The curves alone. With it the camera steps on curves and the marks
   * follow as an overlay tier; without it a block carries both. */
  fetchSeries?: (year: number, month: number, count: number, signal: AbortSignal) => Promise<EphemerisBlocksWire>;
}>;

/** A view's visible time range, its last pan direction (-1 earlier, 1
 * later) and the year layers it draws over that range. */
export type EphemerisInterest = Readonly<{
  startJd: number;
  endJd: number;
  panDirection: -1 | 0 | 1;
  layers?: readonly string[];
}>;

/** A year layer: rows per calendar year from one daemon route. `decode`
 * returns null to refuse a response (computed for another key); a refusal
 * backs off like a failed fetch. */
export type EphemerisYearLayerSpec = Readonly<{
  fetchYear: (year: number, signal: AbortSignal) => Promise<unknown>;
  decode: (wire: unknown) => readonly unknown[] | null;
}>;

export type EphemerisMonthWindow = Readonly<{
  /** Months intersecting the visible range, in loading order. */
  visible: readonly number[];
  /** Margin months in the pan direction, nearest first. */
  ahead: readonly number[];
  /** Margin months behind the pan direction, nearest first. */
  behind: readonly number[];
}>;

export type EphemerisFetchSample = Readonly<{
  kind: "blocks" | "marks" | "stations" | "layer";
  label: string;
  wireBytes: number;
  residentBytes: number;
  ms: number;
}>;

export type EphemerisStoreOptions = Readonly<{
  byteBudget?: number;
  maxInFlight?: number;
  maxBatch?: number;
  /** Margin on each side as a fraction of the visible months (at least one). */
  marginFraction?: number;
  /** How long the view range must stay put before overlay work (marks,
   * stations, year layers) starts; see OVERLAY_SETTLE_MS. */
  settleMs?: number;
  /** First retry delay after a failed fetch; doubles up to `retryMaxMs`. */
  retryMinMs?: number;
  retryMaxMs?: number;
  now?: () => number;
  /** The wake timer (retries, overlay settle, key swap); tests drive it on
   * the same virtual clock as `now`. */
  timers?: Readonly<{ set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void }>;
  onFetch?: (sample: EphemerisFetchSample) => void;
}>;

export type EphemerisFrameData = Readonly<{
  dataKey: string | null;
  /** Resident blocks over the range, ascending; gaps are simply missing. */
  blocks: readonly EphemerisBlock[];
  stationYears: readonly EphemerisStationYear[];
}>;

export type EphemerisRequestPlan =
  | Readonly<{ kind: "blocks"; startIndex: number; count: number }>
  | Readonly<{ kind: "marks"; startIndex: number; count: number }>
  | Readonly<{ kind: "stations"; year: number }>
  | Readonly<{ kind: "layer"; layerId: string; year: number }>;

type PlanGroup =
  | Readonly<{ kind: "blocks"; months: readonly number[] }>
  | Readonly<{ kind: "marks"; months: readonly number[] }>
  | Readonly<{ kind: "stations"; years: readonly number[] }>
  | Readonly<{ kind: "layer"; layerId: string; years: readonly number[] }>;

type WantedFn = (kind: "blocks" | "marks" | "stations" | "layer", id: number, layerId?: string) => boolean;

export const EPHEMERIS_MAX_BATCH_MONTHS = 24;
/** Months per request by default: one year step's worth, so the year a step
 * waits for arrives on its own (~120 ms cold) instead of bundled with the next. */
const DEFAULT_BATCH_MONTHS = 12;
const DEFAULT_BYTE_BUDGET = 24 * 1024 * 1024;
const DEFAULT_MAX_IN_FLIGHT = 3;
/** After a data-key switch, wait this long for the new key's stations once
 * its curves cover the view, then swap without them. */
const STATION_SWAP_GRACE_MS = 1200;
/** Overlay work (marks, station letters, year layers) waits until the view
 * range has held still this long. Longer than the key-repeat delay, so a
 * held arrow's first repeat does not find slow overlay requests queued in
 * the daemon in front of the next curves; short enough that a released
 * burst fills in at once. While the range moves only curves load. */
const OVERLAY_SETTLE_MS = 250;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** Resident estimate of one decoded year-layer row (a small frozen object). */
const LAYER_ROW_BYTES = 64;
const LAYER_YEAR_OVERHEAD_BYTES = 256;
const MIN_MARGIN_MONTHS = 12;
/** Over budget, evict down to this fraction of it, so eviction runs rarely
 * and in batches rather than on every insert at the edge of a burst. */
const EVICT_LOW_WATERMARK = 0.85;
/** Backoff entries are pruned once the map grows past this (and then past
 * twice its surviving size), so failures during a long burst stay bounded. */
const RETRY_PRUNE_MIN = 256;

function rangeMonths(startJd: number, endJd: number): { first: number; last: number } {
  const first = monthIndexOfJd(startJd);
  const last = Math.max(first, monthIndexOfJd(Math.max(startJd, endJd - 1e-7)));
  return { first, last };
}

/** Which months a view needs, in priority order: visible months (walked in
 * the pan direction), then the margin ahead (wider), then the margin behind. */
export function ephemerisMonthWindow(interest: EphemerisInterest, marginFraction = 0.5): EphemerisMonthWindow {
  const { first, last } = rangeMonths(interest.startJd, interest.endJd);
  const visibleCount = last - first + 1;
  // At least a year either side, so a year step lands on resident months.
  const margin = marginFraction > 0 ? Math.max(MIN_MARGIN_MONTHS, Math.ceil(visibleCount * marginFraction)) : 0;
  const lead = interest.panDirection === 0 ? margin : margin * 2;
  const visible: number[] = [];
  for (let i = first; i <= last; i++) visible.push(i);
  const after = (count: number) => Array.from({ length: count }, (_, k) => last + 1 + k);
  const before = (count: number) => Array.from({ length: count }, (_, k) => first - 1 - k);
  if (interest.panDirection < 0) {
    visible.reverse();
    return { visible, ahead: before(lead), behind: after(margin) };
  }
  return { visible, ahead: after(lead), behind: before(margin) };
}

/** Calendar years of a month list, in its order (nearest first). */
function yearsOf(months: readonly number[]): number[] {
  const years: number[] = [];
  for (const index of months) {
    const { year } = monthIndexYearMonth(index);
    if (!years.includes(year)) years.push(year);
  }
  return years;
}

/** Turn priority groups into requests: each group's wanted months become
 * contiguous runs of at most `maxBatch`, ordered by their best priority. */
export function planEphemerisRequests(
  groups: readonly PlanGroup[],
  wanted: WantedFn,
  maxBatch = EPHEMERIS_MAX_BATCH_MONTHS,
): EphemerisRequestPlan[] {
  const plan: EphemerisRequestPlan[] = [];
  const planned = new Set<string>();
  for (const group of groups) {
    if (group.kind === "layer") {
      for (const year of group.years) {
        const id = `l${group.layerId}\u0001${year}`;
        if (planned.has(id) || !wanted("layer", year, group.layerId)) continue;
        planned.add(id);
        plan.push({ kind: "layer", layerId: group.layerId, year });
      }
      continue;
    }
    if (group.kind === "stations") {
      for (const year of group.years) {
        const id = `s${year}`;
        if (planned.has(id) || !wanted("stations", year)) continue;
        planned.add(id);
        plan.push({ kind: "stations", year });
      }
      continue;
    }
    const tier = group.kind;
    const prefix = tier === "marks" ? "m" : "b";
    const priority = new Map<number, number>();
    group.months.forEach((index, order) => {
      if (!planned.has(`${prefix}${index}`) && !priority.has(index) && wanted(tier, index)) priority.set(index, order);
    });
    const sorted = [...priority.keys()].sort((a, b) => a - b);
    const runs: Array<{ startIndex: number; count: number; best: number }> = [];
    for (const index of sorted) {
      const run = runs[runs.length - 1];
      const order = priority.get(index) ?? 0;
      if (run && index === run.startIndex + run.count && run.count < maxBatch) {
        run.count += 1;
        run.best = Math.min(run.best, order);
      } else {
        runs.push({ startIndex: index, count: 1, best: order });
      }
    }
    runs.sort((a, b) => a.best - b.best);
    for (const run of runs) {
      for (let k = 0; k < run.count; k++) planned.add(`${prefix}${run.startIndex + k}`);
      plan.push({ kind: tier, startIndex: run.startIndex, count: run.count });
    }
  }
  return plan;
}

type Pending = {
  controller: AbortController;
  dataKey: string;
  ids: string[];
  /** Curves gate the camera; overlays (marks, stations, layers) fill in. */
  overlay: boolean;
  /** Year-layer requests: the layer and the layer key they were sent under. */
  layerId?: string;
  layerKey?: string;
};

type Interested = {
  interest: EphemerisInterest;
  window: EphemerisMonthWindow;
  first: number;
  last: number;
  layers: readonly string[];
};

/** One resident entry in LRU order (a Map in insertion order: least
 * recently used first; touch = delete + re-set). */
type LruEntry = Readonly<{ bytes: number; dataKey: string; kind: "block" | "stations" | "layer" }>;

type FrameMemo = { key: string | null; first: number; last: number; revision: number; data: EphemerisFrameData };
type ResidentMemo = { revision: number; resident: boolean };
type LayerState = { spec: EphemerisYearLayerSpec; key: string; asked: Set<number> };
type LayerRowsMemo = { key: string; years: string; revision: number; rows: readonly unknown[] };

const blockId = (dataKey: string, index: number) => `${dataKey}|${index}`;
const marksId = (dataKey: string, index: number) => `${dataKey}|m${index}`;
const yearId = (dataKey: string, year: number) => `${dataKey}|y${year}`;
const layerYearId = (layerId: string, layerKey: string, year: number) => `L${layerId}\u0001${layerKey}\u0001${year}`;
const EMPTY_ROWS: readonly unknown[] = Object.freeze([]);
const sameLayers = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);
const NO_KEY = "\u0000";
const queueTask =
  typeof queueMicrotask === "function" ? queueMicrotask : (task: () => void) => void Promise.resolve().then(task);

export class EphemerisBlockStore {
  private readonly fetchers: EphemerisBlockFetchers;
  private readonly byteBudget: number;
  private readonly maxInFlight: number;
  private readonly maxBatch: number;
  private readonly marginFraction: number;
  private readonly settleMs: number;
  /** When a view's month window last moved (overlays wait for it to hold). */
  private movedAt = -Infinity;
  private readonly retryMinMs: number;
  private readonly retryMaxMs: number;
  private readonly now: () => number;
  private readonly onFetch?: (sample: EphemerisFetchSample) => void;

  private readonly blocks = new Map<string, EphemerisBlock>();
  private readonly years = new Map<string, EphemerisStationYear>();
  /** Registered year layers and their decoded rows per (layer, key, year). */
  private readonly layers = new Map<string, LayerState>();
  private readonly layerYears = new Map<string, readonly unknown[]>();
  private readonly layerRowsMemo = new Map<string, LayerRowsMemo>();
  /** Every resident block and station year, least recently used first. */
  private readonly lru = new Map<string, LruEntry>();
  private readonly pending = new Set<Pending>();
  private readonly inFlightIds = new Set<string>();
  private readonly retry = new Map<string, { until: number; delay: number }>();
  private retryPruneAt = RETRY_PRUNE_MIN;
  /** Views in recency order (most recently declared last). */
  private readonly interests = new Map<string, Interested>();
  private lastInterestId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private notifyQueued = false;
  /** What the live views need under the current and drawn keys; rebuilt
   * lazily after an interest or key change, never per insert. */
  private pinned = new Set<string>();
  private pinnedDirty = true;
  /** Bumped whenever resident data or the drawn key changes. */
  private revision = 0;
  private frameMemo: FrameMemo | null = null;
  private readonly residentMemo = new Map<string, ResidentMemo>();
  private residentBytes = 0;
  private currentKey: string | null = null;
  private drawKey: string | null = null;
  private keySince = 0;
  private wakeTimer: unknown = null;
  private readonly timers: NonNullable<EphemerisStoreOptions["timers"]>;
  private wakeAt = Infinity;
  private lastError: string | null = null;

  constructor(fetchers: EphemerisBlockFetchers, options: EphemerisStoreOptions = {}) {
    this.fetchers = fetchers;
    this.byteBudget = options.byteBudget ?? DEFAULT_BYTE_BUDGET;
    this.maxInFlight = Math.max(1, options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT);
    this.maxBatch = Math.max(1, Math.min(EPHEMERIS_MAX_BATCH_MONTHS, options.maxBatch ?? DEFAULT_BATCH_MONTHS));
    this.marginFraction = options.marginFraction ?? 0.5;
    this.settleMs = Math.max(0, options.settleMs ?? OVERLAY_SETTLE_MS);
    this.retryMinMs = Math.max(1, options.retryMinMs ?? RETRY_MIN_MS);
    this.retryMaxMs = Math.max(this.retryMinMs, options.retryMaxMs ?? RETRY_MAX_MS);
    this.now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.onFetch = options.onFetch;
    this.timers = options.timers ?? {
      set: (run, ms) => setTimeout(run, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get dataKey(): string | null {
    return this.currentKey;
  }

  get error(): string | null {
    return this.lastError;
  }

  stats(): { residentBytes: number; blocks: number; stationYears: number; layerYears: number; inFlight: number } {
    return {
      residentBytes: this.residentBytes,
      blocks: this.blocks.size,
      stationYears: this.years.size,
      layerYears: this.layerYears.size,
      inFlight: this.pending.size,
    };
  }

  /** Register a year layer once (later calls keep the first spec). */
  defineYearLayer(layerId: string, spec: EphemerisYearLayerSpec): void {
    if (!this.layers.has(layerId)) this.layers.set(layerId, { spec, key: "", asked: new Set() });
  }

  /** The layer's identity (e.g. radix point set + data key); "" disables it.
   * A new key aborts the layer's requests under the old one; old rows stay
   * in the LRU (a quick return is warm) but are never drawn. */
  setLayerKey(layerId: string, key: string): void {
    const layer = this.layers.get(layerId);
    if (!layer || layer.key === key) return;
    layer.key = key;
    layer.asked.clear();
    this.pinnedDirty = true;
    this.revision += 1;
    this.pump();
    this.notify();
  }

  layerKey(layerId: string): string {
    return this.layers.get(layerId)?.key ?? "";
  }

  /** Ask for layer years outside any view's range (an export, a test); they
   * go first and stay pinned until they load or fail. */
  askLayerYears(layerId: string, years: readonly number[]): void {
    const layer = this.layers.get(layerId);
    if (!layer || !layer.key) return;
    for (const year of years) {
      if (!this.layerYears.has(layerYearId(layerId, layer.key, year))) layer.asked.add(year);
    }
    this.pinnedDirty = true;
    this.pump();
  }

  /** Resident rows of a layer over the given years under its current key,
   * concatenated in year order; the same years over unchanged data return
   * the previous array (so per-frame filters can memo on identity). */
  layerRows(layerId: string, years: readonly number[]): readonly unknown[] {
    const layer = this.layers.get(layerId);
    if (!layer || !layer.key) return EMPTY_ROWS;
    const yearsKey = years.join(",");
    const memo = this.layerRowsMemo.get(layerId);
    if (memo && memo.key === layer.key && memo.years === yearsKey && memo.revision === this.revision) {
      for (const year of years) this.touch(layerYearId(layerId, layer.key, year));
      return memo.rows;
    }
    const rows: unknown[] = [];
    for (const year of years) {
      const id = layerYearId(layerId, layer.key, year);
      const resident = this.layerYears.get(id);
      if (!resident) continue;
      this.touch(id);
      for (const row of resident) rows.push(row);
    }
    const frozen = Object.freeze(rows);
    this.layerRowsMemo.set(layerId, { key: layer.key, years: yearsKey, revision: this.revision, rows: frozen });
    return frozen;
  }

  /** Every year resident or settled on a failure (an export paints what a
   * settled frame would show), or after `timeoutMs`. */
  whenLayerSettled(layerId: string, years: readonly number[], timeoutMs = 8000): Promise<void> {
    this.askLayerYears(layerId, years);
    const settled = () => {
      const layer = this.layers.get(layerId);
      if (!layer || !layer.key) return true;
      return years.every((year) => {
        const id = layerYearId(layerId, layer.key, year);
        return this.layerYears.has(id) || (!this.inFlightIds.has(id) && this.retry.has(id));
      });
    };
    if (settled()) return Promise.resolve();
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        resolve();
      }, timeoutMs);
      unsubscribe = this.subscribe(() => {
        if (!settled()) return;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      });
    });
  }

  /** The meta revision's data identity. Old blocks stay drawable until the
   * new key covers the visible range. */
  setDataKey(dataKey: string): void {
    if (!dataKey || dataKey === this.currentKey) return;
    if (this.currentKey) {
      for (const request of this.pending) this.cancel(request);
    } else {
      this.rekeyUnkeyed(dataKey);
    }
    this.currentKey = dataKey;
    this.keySince = this.now();
    if (!this.drawKey) this.setDrawKey(dataKey);
    this.pinnedDirty = true;
    this.retry.clear();
    this.retryPruneAt = RETRY_PRUNE_MIN;
    this.pump();
  }

  /** Declare (or with null withdraw) one view's range; cheap to call per
   * frame: an unchanged month window is a no-op beyond recency. */
  setInterest(viewId: string, interest: EphemerisInterest | null): void {
    if (!interest) {
      if (this.interests.delete(viewId)) {
        if (this.lastInterestId === viewId) this.lastInterestId = null;
        this.pinnedDirty = true;
        this.pump();
      }
      return;
    }
    const { first, last } = rangeMonths(interest.startJd, interest.endJd);
    const layers = interest.layers ?? [];
    const previous = this.interests.get(viewId);
    if (this.lastInterestId !== viewId) {
      // Most recently declared view last; only reorders when views alternate.
      if (previous) this.interests.delete(viewId);
      this.lastInterestId = viewId;
    }
    if (
      previous &&
      previous.first === first &&
      previous.last === last &&
      previous.interest.panDirection === interest.panDirection &&
      sameLayers(previous.layers, layers)
    ) {
      previous.interest = interest;
      if (!this.interests.has(viewId)) this.interests.set(viewId, previous);
      return;
    }
    const window = ephemerisMonthWindow(interest, this.marginFraction);
    if (previous && (previous.first !== first || previous.last !== last)) this.movedAt = this.now();
    this.interests.set(viewId, { interest, window, first, last, layers: [...layers] });
    this.pinnedDirty = true;
    this.pump();
  }

  /** Resident data over [startJd, endJd) for one frame. An unchanged range
   * over unchanged data returns the previous frame's object. */
  frameData(startJd: number, endJd: number): EphemerisFrameData {
    const { first, last } = rangeMonths(startJd, endJd);
    const key = this.resolveDrawKey(first, last);
    const memo = this.frameMemo;
    if (memo && memo.key === key && memo.first === first && memo.last === last && memo.revision === this.revision) {
      return memo.data;
    }
    const blocks: EphemerisBlock[] = [];
    const stationYears: EphemerisStationYear[] = [];
    if (key) {
      for (let index = first; index <= last; index++) {
        const id = blockId(key, index);
        const block = this.blocks.get(id);
        if (!block) continue;
        this.touch(id);
        blocks.push(block);
      }
      const firstYear = monthIndexYearMonth(first).year;
      const lastYear = monthIndexYearMonth(last).year;
      for (let year = firstYear; year <= lastYear; year++) {
        const id = yearId(key, year);
        const layer = this.years.get(id);
        if (!layer) continue;
        this.touch(id);
        stationYears.push(layer);
      }
    }
    const data: EphemerisFrameData = { dataKey: key, blocks, stationYears };
    this.frameMemo = { key, first, last, revision: this.revision, data };
    return data;
  }

  /** Whether every month (and station year) of the range is resident for
   * the current key, and every year of the given layers under theirs (a
   * step lands on this; export waits for it). A layer without a key has
   * nothing to wait for. */
  isResident(startJd: number, endJd: number, includeStations = true, layers: readonly string[] = []): boolean {
    const key = this.currentKey;
    if (!key) return false;
    const { first, last } = rangeMonths(startJd, endJd);
    const layerKeys = layers.map((id) => `${id}\u0001${this.layerKey(id)}`).join("\u0002");
    const memoKey = `${key}|${first}|${last}|${includeStations ? 1 : 0}|${layerKeys}`;
    const memo = this.residentMemo.get(memoKey);
    if (memo && memo.revision === this.revision) return memo.resident;
    let resident = this.covers(key, first, last, includeStations);
    if (resident && layers.length) {
      const years = yearsOf([first, last]);
      for (let year = years[0]; resident && year <= years[years.length - 1]; year++) {
        for (const id of layers) {
          const layerKey = this.layerKey(id);
          if (layerKey && !this.layerYears.has(layerYearId(id, layerKey, year))) {
            resident = false;
            break;
          }
        }
      }
    }
    if (this.residentMemo.size >= 8) this.residentMemo.clear();
    this.residentMemo.set(memoKey, { revision: this.revision, resident });
    return resident;
  }

  /** Resolve once the range is resident (or after `timeoutMs`). */
  whenResident(startJd: number, endJd: number, timeoutMs = 8000): Promise<boolean> {
    if (this.isResident(startJd, endJd)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);
      unsubscribe = this.subscribe(() => {
        if (!this.isResident(startJd, endJd)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      });
    });
  }

  /** Curves over the range; with `complete`, every month's marks and the
   * station years too. */
  private covers(key: string, first: number, last: number, complete: boolean): boolean {
    for (let index = first; index <= last; index++) {
      const block = this.blocks.get(blockId(key, index));
      if (!block || (complete && !block.marks)) return false;
    }
    if (!complete) return true;
    const firstYear = monthIndexYearMonth(first).year;
    const lastYear = monthIndexYearMonth(last).year;
    for (let year = firstYear; year <= lastYear; year++) {
      if (!this.years.has(yearId(key, year))) return false;
    }
    return true;
  }

  private hasAny(key: string, first: number, last: number): boolean {
    for (let index = first; index <= last; index++) {
      if (this.blocks.has(blockId(key, index))) return true;
    }
    return false;
  }

  /** Keep drawing the previous key until the current one covers the range. */
  private resolveDrawKey(first: number, last: number): string | null {
    const current = this.currentKey;
    const drawn = this.drawKey;
    if (!current || !drawn || drawn === current) return current ?? drawn;
    const curvesReady = this.covers(current, first, last, false);
    const graceOver = this.now() - this.keySince >= STATION_SWAP_GRACE_MS;
    if (
      this.covers(current, first, last, true) ||
      (curvesReady && graceOver) ||
      !this.hasAny(drawn, first, last)
    ) {
      this.setDrawKey(current);
      this.demoteStale();
      this.evict();
      return current;
    }
    if (curvesReady) this.wake(this.keySince + STATION_SWAP_GRACE_MS);
    return drawn;
  }

  private setDrawKey(key: string): void {
    this.drawKey = key;
    this.pinnedDirty = true;
    this.revision += 1;
  }

  /** At most one listener pass per microtask, however many requests land. */
  private notify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueTask(() => {
      this.notifyQueued = false;
      for (const listener of this.listeners) listener();
    });
  }

  private wake(at: number): void {
    if (at >= this.wakeAt) return;
    if (this.wakeTimer != null) this.timers.clear(this.wakeTimer);
    this.wakeAt = at;
    this.wakeTimer = this.timers.set(() => {
      this.wakeTimer = null;
      this.wakeAt = Infinity;
      this.pump();
      this.notify();
    }, Math.max(0, at - this.now()));
  }

  /** Most recently declared view first (a handful of views at most). */
  private interestsByRecency(): Interested[] {
    return [...this.interests.values()].reverse();
  }

  /** Ids the live views need under the current and drawn keys: visible plus
   * margin, so O(views × window), rebuilt only after a change. */
  private pinnedIds(): Set<string> {
    if (!this.pinnedDirty) return this.pinned;
    const ids = new Set<string>();
    for (const key of [this.currentKey, this.drawKey]) {
      if (!key) continue;
      for (const { window } of this.interests.values()) {
        for (const months of [window.visible, window.ahead, window.behind]) {
          for (const index of months) ids.add(blockId(key, index));
          for (const year of yearsOf(months)) ids.add(yearId(key, year));
        }
      }
    }
    for (const { window, layers } of this.interests.values()) {
      if (!layers.length) continue;
      const years = yearsOf([...window.visible, ...window.ahead, ...window.behind]);
      for (const layerId of layers) {
        const layerKey = this.layerKey(layerId);
        if (layerKey) for (const year of years) ids.add(layerYearId(layerId, layerKey, year));
      }
    }
    for (const [layerId, layer] of this.layers) {
      if (layer.key) for (const year of layer.asked) ids.add(layerYearId(layerId, layer.key, year));
    }
    this.pinned = ids;
    this.pinnedDirty = false;
    return ids;
  }

  private pruneRetry(now: number): void {
    if (this.retry.size <= this.retryPruneAt) return;
    for (const [id, backoff] of this.retry) {
      if (backoff.until + RETRY_MAX_MS <= now) this.retry.delete(id);
    }
    this.retryPruneAt = Math.max(RETRY_PRUNE_MIN, this.retry.size * 2);
  }

  /** Start the highest-priority missing requests. A request the camera has
   * moved past is not aborted: aborting does not stop the daemon computing it,
   * so aborts during a key burst only stack hidden work in front of the months
   * now in view. Letting it finish keeps that queue bounded by `maxInFlight`
   * (and caches the months it brings). Only a data-key change aborts. */
  private pump(): void {
    const key = this.currentKey ?? NO_KEY;
    for (const request of this.pending) {
      const stale =
        request.layerId != null ? this.layerKey(request.layerId) !== request.layerKey : request.dataKey !== key;
      if (stale) this.cancel(request);
    }
    if (this.pending.size >= this.maxInFlight) return;
    // Priority: curves first (where the camera lands, the pan direction,
    // behind), always; overlays (the months' marks, the year layers drawn
    // over them, station letters: heading, then ahead, then behind) only
    // once the range has held still for `settleMs`.
    const groups: PlanGroup[] = [];
    const interests = this.interestsByRecency();
    const now = this.now();
    const settledAt = this.movedAt + this.settleMs;
    const settled = now >= settledAt;
    const layerGroups = (yearsFor: (window: EphemerisMonthWindow) => number[]) => {
      for (const { window, layers } of interests) {
        if (!layers.length) continue;
        const years = yearsFor(window);
        for (const layerId of layers) groups.push({ kind: "layer", layerId, years });
      }
    };
    for (const { window } of interests) groups.push({ kind: "blocks", months: window.visible });
    for (const [layerId, layer] of this.layers) {
      if (layer.asked.size) groups.push({ kind: "layer", layerId, years: [...layer.asked] });
    }
    for (const { window } of interests) groups.push({ kind: "blocks", months: window.ahead });
    for (const { window } of interests) groups.push({ kind: "blocks", months: window.behind });
    if (settled) {
      for (const { window } of interests) groups.push({ kind: "marks", months: window.visible });
      layerGroups((window) => yearsOf(window.visible));
      for (const { window } of interests) groups.push({ kind: "stations", years: yearsOf(window.visible) });
      for (const { window } of interests) groups.push({ kind: "marks", months: window.ahead });
      layerGroups((window) => yearsOf(window.ahead));
      for (const { window } of interests) groups.push({ kind: "marks", months: window.behind });
      for (const { window } of interests) groups.push({ kind: "stations", years: yearsOf([...window.ahead, ...window.behind]) });
      layerGroups((window) => yearsOf(window.behind));
    }
    this.pruneRetry(now);
    let nextRetry = Infinity;
    const wanted: WantedFn = (kind, id, layerId) => {
      let fullId: string;
      if (kind === "layer") {
        const layerKey = layerId != null ? this.layerKey(layerId) : "";
        if (!layerKey) return false;
        fullId = layerYearId(layerId as string, layerKey, id);
        if (this.layerYears.has(fullId) || this.inFlightIds.has(fullId)) return false;
      } else if (kind === "marks") {
        // Only for curves already resident; without a series route a
        // block brings its marks with it.
        if (!this.fetchers.fetchSeries) return false;
        const block = this.blocks.get(blockId(key, id));
        if (!block || block.marks) return false;
        fullId = marksId(key, id);
        if (this.inFlightIds.has(fullId)) return false;
      } else {
        fullId = kind === "blocks" ? blockId(key, id) : yearId(key, id);
        if (this.blocks.has(fullId) || this.years.has(fullId) || this.inFlightIds.has(fullId)) return false;
      }
      const backoff = this.retry.get(fullId);
      if (backoff && backoff.until > now) {
        nextRetry = Math.min(nextRetry, backoff.until);
        return false;
      }
      return true;
    };
    const plan = planEphemerisRequests(groups, wanted, this.maxBatch);
    // Overlays never take the last slot: a curve request the next step
    // needs always finds one free.
    const overlayCap = Math.max(1, this.maxInFlight - 1);
    let overlays = 0;
    for (const request of this.pending) if (request.overlay) overlays += 1;
    for (const request of plan) {
      if (this.pending.size >= this.maxInFlight) break;
      const overlay = request.kind !== "blocks";
      if (overlay && overlays >= overlayCap) continue;
      if (overlay) overlays += 1;
      this.start(key, request);
    }
    if (nextRetry < Infinity) this.wake(nextRetry);
    if (!settled && interests.length) this.wake(settledAt);
  }

  private start(key: string, request: EphemerisRequestPlan): void {
    const controller = new AbortController();
    const layerKey = request.kind === "layer" ? this.layerKey(request.layerId) : undefined;
    const ids =
      request.kind === "blocks" || request.kind === "marks"
        ? Array.from({ length: request.count }, (_, k) =>
            (request.kind === "marks" ? marksId : blockId)(key, request.startIndex + k),
          )
        : request.kind === "layer"
          ? [layerYearId(request.layerId, layerKey as string, request.year)]
          : [yearId(key, request.year)];
    const overlay = request.kind !== "blocks";
    const entry: Pending =
      request.kind === "layer"
        ? { controller, dataKey: key, ids, overlay, layerId: request.layerId, layerKey }
        : { controller, dataKey: key, ids, overlay };
    this.pending.add(entry);
    for (const id of ids) this.inFlightIds.add(id);
    const startedAt = this.now();
    const finish = () => {
      this.pending.delete(entry);
      for (const id of entry.ids) this.inFlightIds.delete(id);
    };
    let label: string;
    let work: Promise<void>;
    if (request.kind === "blocks" || request.kind === "marks") {
      const { year, month } = monthIndexYearMonth(request.startIndex);
      const kind = request.kind;
      label = `${kind === "marks" ? "marks " : ""}${year}-${month}+${request.count}`;
      const fetch =
        kind === "blocks" ? (this.fetchers.fetchSeries ?? this.fetchers.fetchBlocks) : this.fetchers.fetchBlocks;
      work = fetch(year, month, request.count, controller.signal).then((wire) => {
        if (controller.signal.aborted) return;
        const decoded = decodeEphemerisBlocks(wire);
        let resident = 0;
        for (const block of decoded) {
          resident += block.bytes;
          this.insertBlock(block);
        }
        this.adoptResponseKey(entry, wire.dataKey);
        this.onFetch?.({ kind, label, wireBytes: wire.wireBytes ?? 0, residentBytes: resident, ms: this.now() - startedAt });
      });
    } else if (request.kind === "layer") {
      const layerId = request.layerId;
      const spec = this.layers.get(layerId)?.spec;
      label = `${layerId} ${request.year}`;
      work = (spec ? spec.fetchYear(request.year, controller.signal) : Promise.reject(new Error(`no layer ${layerId}`))).then(
        (wire) => {
          if (controller.signal.aborted) return;
          const rows = spec?.decode(wire);
          if (!rows) throw new Error(`${label}: refused`);
          const frozen = Object.isFrozen(rows) ? rows : Object.freeze([...rows]);
          const bytes = LAYER_YEAR_OVERHEAD_BYTES + frozen.length * LAYER_ROW_BYTES;
          this.insertLayerYear(ids[0], frozen, layerKey as string, bytes);
          if (this.layers.get(layerId)?.asked.delete(request.year)) this.pinnedDirty = true;
          this.onFetch?.({ kind: "layer", label, wireBytes: 0, residentBytes: bytes, ms: this.now() - startedAt });
        },
      );
    } else {
      label = `stations ${request.year}`;
      work = this.fetchers.fetchStationYear(request.year, controller.signal).then((wire) => {
        if (controller.signal.aborted) return;
        const layer = decodeEphemerisStationYear(wire);
        this.insertYear(layer);
        this.adoptResponseKey(entry, wire.dataKey);
        this.onFetch?.({ kind: "stations", label, wireBytes: wire.wireBytes ?? 0, residentBytes: layer.bytes, ms: this.now() - startedAt });
      });
    }
    work
      .then(() => {
        if (controller.signal.aborted) return;
        for (const id of entry.ids) this.retry.delete(id);
        this.lastError = null;
        finish();
        this.evict();
        this.pump();
        this.notify();
      })
      .catch((error: unknown) => {
        finish();
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          this.pump();
          return;
        }
        const now = this.now();
        for (const id of entry.ids) {
          const delay = Math.min(this.retryMaxMs, (this.retry.get(id)?.delay ?? this.retryMinMs / 2) * 2);
          this.retry.set(id, { until: now + delay, delay });
        }
        if (request.kind === "layer") {
          // A failed ask settles (an export paints without it); the view's
          // interest keeps asking after the backoff.
          this.layers.get(request.layerId)?.asked.delete(request.year);
          this.pinnedDirty = true;
        } else {
          this.lastError = error instanceof Error ? error.message : String(error);
        }
        this.pump();
        this.notify();
      });
  }

  /** A response under a key the store has not seen means the daemon's data
   * moved on (or this was the very first response): follow it. */
  private adoptResponseKey(request: Pending, responseKey: string): void {
    if (!responseKey || responseKey === this.currentKey) return;
    if (request.dataKey !== NO_KEY && request.dataKey !== this.currentKey) return;
    if (this.currentKey) {
      for (const other of this.pending) if (other !== request) this.cancel(other);
    } else {
      this.rekeyUnkeyed(responseKey);
    }
    this.currentKey = responseKey;
    this.keySince = this.now();
    this.pinnedDirty = true;
    if (!this.drawKey) this.setDrawKey(responseKey);
  }

  /** Abort a request and free its slot at once (its late answer is ignored). */
  private cancel(request: Pending): void {
    request.controller.abort();
    this.pending.delete(request);
    for (const id of request.ids) this.inFlightIds.delete(id);
  }

  /** Requests sent before any key was known belong to the first key seen. */
  private rekeyUnkeyed(dataKey: string): void {
    for (const request of this.pending) {
      if (request.dataKey !== NO_KEY) continue;
      for (const id of request.ids) this.inFlightIds.delete(id);
      request.dataKey = dataKey;
      request.ids = request.ids.map((id) => dataKey + id.slice(NO_KEY.length));
      for (const id of request.ids) this.inFlightIds.add(id);
    }
  }

  /** Mark an entry most recently used: O(1). */
  private touch(id: string): void {
    const entry = this.lru.get(id);
    if (!entry) return;
    this.lru.delete(id);
    this.lru.set(id, entry);
  }

  private remember(id: string, entry: LruEntry, previousBytes: number): void {
    this.residentBytes += entry.bytes - previousBytes;
    this.lru.delete(id);
    this.lru.set(id, entry);
    this.revision += 1;
  }

  /** Curves land as the month's block (keeping marks already merged);
   * marks merge into resident curves, or are dropped when the curves have
   * gone (they are asked for again with them). */
  private insertBlock(incoming: EphemerisBlock): void {
    const id = blockId(incoming.dataKey, incoming.monthIndex);
    const existing = this.blocks.get(id);
    let block = incoming;
    if (!incoming.curves) {
      if (!existing || !incoming.marks) return;
      block = mergeEphemerisMarks(existing, incoming);
    } else if (!incoming.marks && existing?.marks) {
      block = mergeEphemerisMarks(incoming, existing);
    }
    const previous = existing?.bytes ?? 0;
    this.blocks.set(id, block);
    this.remember(id, { bytes: block.bytes, dataKey: block.dataKey, kind: "block" }, previous);
  }

  private insertYear(layer: EphemerisStationYear): void {
    const id = yearId(layer.dataKey, layer.year);
    const previous = this.years.get(id)?.bytes ?? 0;
    this.years.set(id, layer);
    this.remember(id, { bytes: layer.bytes, dataKey: layer.dataKey, kind: "stations" }, previous);
  }

  private insertLayerYear(id: string, rows: readonly unknown[], layerKey: string, bytes: number): void {
    const previous = this.lru.get(id)?.bytes ?? 0;
    this.layerYears.set(id, rows);
    this.remember(id, { bytes, dataKey: layerKey, kind: "layer" }, previous);
  }

  /** After the drawn key moves on, entries of keys no view draws go to the
   * front of the LRU (evicted first). Runs once per data-key change. */
  private demoteStale(): void {
    const live: LruEntry[] = [];
    const liveIds: string[] = [];
    for (const [id, entry] of this.lru) {
      // Layer entries keep their place: their key is the layer's own.
      if (entry.kind !== "layer" && entry.dataKey !== this.currentKey && entry.dataKey !== this.drawKey) continue;
      this.lru.delete(id);
      liveIds.push(id);
      live.push(entry);
    }
    for (let i = 0; i < liveIds.length; i++) this.lru.set(liveIds[i], live[i]);
  }

  /** LRU by bytes with a high/low watermark: once over budget, drop the
   * least recently used entries (other keys first, see `demoteStale`) down
   * to `EVICT_LOW_WATERMARK` of it; never what a view currently needs under
   * the drawn or current key. Walks only from the cold end. */
  private evict(): void {
    if (this.residentBytes <= this.byteBudget) return;
    const target = this.byteBudget * EVICT_LOW_WATERMARK;
    const pinned = this.pinnedIds();
    let removed = false;
    for (const [id, entry] of this.lru) {
      if (this.residentBytes <= target) break;
      if (pinned.has(id)) continue;
      this.lru.delete(id);
      if (entry.kind === "stations") this.years.delete(id);
      else if (entry.kind === "layer") this.layerYears.delete(id);
      else this.blocks.delete(id);
      this.residentBytes -= entry.bytes;
      removed = true;
    }
    if (removed) this.revision += 1;
  }
}
