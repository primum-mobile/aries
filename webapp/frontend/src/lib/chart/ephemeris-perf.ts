// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Dev-only Graphic Ephemeris timing. Off in production builds. In a dev
// session, read it from the console:
//   __ariesEphemerisPerf.report()   frame paint, first useful paint, fetches
// Entries also land as performance.measure("ephem:…") marks for the
// Timeline (frame and fetch marks are cleared every few hundred entries, so
// a long session does not grow the performance timeline).

const ENABLED = process.env.NODE_ENV !== "production";
const RING = 240;
const FRAME_MEASURE_CLEAR_EVERY = 600;
const FETCH_MEASURE = "ephem:fetch";
const FETCH_MEASURE_CLEAR_EVERY = 300;

type FetchRecord = { label: string; kind: string; wireBytes: number; residentBytes: number; ms: number };

type PerfState = {
  /** Ring of the last RING frame times (written at frameCount % RING). */
  frames: number[];
  frameCount: number;
  fetchCount: number;
  firstPaint: Array<{ kind: "cold" | "warm"; ms: number }>;
  fetches: FetchRecord[];
};

const state: PerfState = { frames: [], frameCount: 0, fetchCount: 0, firstPaint: [], fetches: [] };

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function install() {
  if (!ENABLED || typeof window === "undefined") return;
  const host = window as unknown as { __ariesEphemerisPerf?: unknown };
  if (host.__ariesEphemerisPerf) return;
  host.__ariesEphemerisPerf = {
    state,
    report() {
      const frames = state.frames;
      const summary = {
        frames: state.frameCount,
        frameP50Ms: Number(percentile(frames, 0.5).toFixed(2)),
        frameP95Ms: Number(percentile(frames, 0.95).toFixed(2)),
        frameMaxMs: Number(Math.max(0, ...frames).toFixed(2)),
        firstPaint: state.firstPaint.map((entry) => `${entry.kind} ${entry.ms.toFixed(1)} ms`).join(", "),
        fetches: state.fetches.length,
        fetchMeanMs: Number(
          (state.fetches.reduce((sum, f) => sum + f.ms, 0) / Math.max(1, state.fetches.length)).toFixed(1),
        ),
        fetchWireKB: Number((state.fetches.reduce((sum, f) => sum + f.wireBytes, 0) / 1024).toFixed(1)),
      };
      console.table(summary);
      console.table(state.fetches.slice(-20));
      return summary;
    },
    reset() {
      state.frames.length = 0;
      state.frameCount = 0;
      state.fetchCount = 0;
      state.firstPaint.length = 0;
      state.fetches.length = 0;
    },
  };
}

export function ephemerisNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** One painted frame (plot layer, plus chrome when it was dirty). */
export function recordEphemerisFrame(startedAt: number): void {
  if (!ENABLED) return;
  install();
  const end = ephemerisNow();
  state.frames[state.frameCount % RING] = end - startedAt;
  state.frameCount += 1;
  try {
    performance.measure("ephem:frame", { start: startedAt, end });
    if (state.frameCount % FRAME_MEASURE_CLEAR_EVERY === 0) performance.clearMeasures("ephem:frame");
  } catch {
    // Older engines without measure options: the ring buffer still records it.
  }
}

/** Mount -> first frame showing data for the whole visible range. */
export function recordEphemerisFirstPaint(kind: "cold" | "warm", mountedAt: number): void {
  if (!ENABLED) return;
  install();
  const end = ephemerisNow();
  state.firstPaint.push({ kind, ms: end - mountedAt });
  try {
    performance.measure(`ephem:first-paint-${kind}`, { start: mountedAt, end });
  } catch {
    // See recordEphemerisFrame.
  }
}

export function recordEphemerisFetch(record: FetchRecord): void {
  if (!ENABLED) return;
  install();
  state.fetches.push(record);
  if (state.fetches.length > RING) state.fetches.shift();
  state.fetchCount += 1;
  try {
    const end = ephemerisNow();
    performance.measure(FETCH_MEASURE, {
      start: end - record.ms,
      end,
      detail: { label: record.label, wireBytes: record.wireBytes, residentBytes: record.residentBytes },
    });
    if (state.fetchCount % FETCH_MEASURE_CLEAR_EVERY === 0) performance.clearMeasures(FETCH_MEASURE);
  } catch {
    // See recordEphemerisFrame.
  }
}
