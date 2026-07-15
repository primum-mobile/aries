// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  fetchChartPickerRows,
  type ChartPickerRow,
  type ChartPickerRowsPayload,
} from "@/lib/daemon/client";
import { isTransientDaemonFetchError } from "@/lib/abort-error";
import { recordChartPerf } from "@/lib/chart/perf";

const STORAGE_KEY = "aries.chartPickerRows.v1";
const STORAGE_MAX_AGE_MS = 10 * 60 * 1000;
export const CHART_PICKER_ROWS_REFRESH_MIN_INTERVAL_MS = 2500;

let rowsCache: ChartPickerRowsPayload | null = null;
let rowsInflight: Promise<ChartPickerRowsPayload> | null = null;
let rowsLoadedAt = 0;

type StoredChartPickerRows = {
  loadedAt: number;
  payload: ChartPickerRowsPayload;
};

function readStoredRows(): StoredChartPickerRows | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredChartPickerRows>;
    if (!parsed || typeof parsed.loadedAt !== "number" || !parsed.payload) {
      return null;
    }
    if (Date.now() - parsed.loadedAt > STORAGE_MAX_AGE_MS) {
      return null;
    }
    return {
      loadedAt: parsed.loadedAt,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

function writeStoredRows(payload: ChartPickerRowsPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ loadedAt: rowsLoadedAt, payload } satisfies StoredChartPickerRows),
    );
  } catch {
    // Storage is only a cross-window warm cache. The in-memory cache is enough.
  }
}

function seedFromStorage(): ChartPickerRowsPayload | null {
  if (rowsCache) return rowsCache;
  const stored = readStoredRows();
  if (!stored) return null;
  rowsCache = stored.payload;
  rowsLoadedAt = stored.loadedAt;
  recordChartPerf("chart-picker-cache", {
    source: "localStorage",
    rows: rowsCache.rows.length,
    ageMs: Date.now() - rowsLoadedAt,
  });
  return rowsCache;
}

export function syncChartPickerRowsFromStorage(): ChartPickerRowsPayload | null {
  const stored = readStoredRows();
  if (!stored) return rowsCache;
  if (stored.loadedAt >= rowsLoadedAt) {
    rowsCache = stored.payload;
    rowsLoadedAt = stored.loadedAt;
    recordChartPerf("chart-picker-cache", {
      source: "localStorage-sync",
      rows: rowsCache.rows.length,
      ageMs: Date.now() - rowsLoadedAt,
    });
  }
  return rowsCache;
}

export function getCachedChartPickerRows(): ChartPickerRowsPayload | null {
  return rowsCache ?? seedFromStorage();
}

export function shouldRefreshChartPickerRows(minIntervalMs: number): boolean {
  seedFromStorage();
  return !rowsLoadedAt || Date.now() - rowsLoadedAt > minIntervalMs;
}

export function loadChartPickerRows(force = false): Promise<ChartPickerRowsPayload> {
  if (!force) {
    const cached = getCachedChartPickerRows();
    if (cached) return Promise.resolve(cached);
  }
  if (rowsInflight) return rowsInflight;
  const request = fetchChartPickerRows()
    .then((payload) => {
      rowsCache = payload;
      rowsLoadedAt = Date.now();
      writeStoredRows(payload);
      return payload;
    })
    .finally(() => {
      if (rowsInflight === request) rowsInflight = null;
    });
  rowsInflight = request;
  return request;
}

export function prewarmChartPickerRows(minIntervalMs: number): void {
  const cached = getCachedChartPickerRows();
  if (!cached || shouldRefreshChartPickerRows(minIntervalMs)) {
    void loadChartPickerRows(!cached).catch((err) => {
      if (isTransientDaemonFetchError(err)) return;
      console.warn("[chart-picker-prewarm]", err);
    });
  }
}

export function replaceCachedChartPickerRows(rows: ChartPickerRow[]): void {
  const cached = getCachedChartPickerRows();
  if (!cached) return;
  rowsCache = { ...cached, rows };
  rowsLoadedAt = Date.now();
  writeStoredRows(rowsCache);
}
