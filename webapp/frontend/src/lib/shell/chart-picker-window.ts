// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { perfNow, recordChartPerf } from "@/lib/chart/perf";
import { loadChartPickerRows } from "@/lib/chart-picker/rows-cache";
import { isTransientDaemonFetchError } from "@/lib/abort-error";
import { resolveShellHost } from "@/lib/shell-host";
import type { ThemeState } from "@/lib/daemon/client";
import { ensureThemeStateCached, getCachedThemeState } from "@/stores/theme-store";

export type ChartPickerWindowMode = "open-radix" | "synastry-partner";

type ChartPickerWindowParams = {
  mode: ChartPickerWindowMode;
  parentRadixId?: string;
  excludeNames?: string[];
};

let prewarmPickerWindowPromise: Promise<void> | null = null;
let prewarmPickerWindowDone = false;

export function prewarmChartPickerWindowApi(): void {
  if (!resolveShellHost().capabilities.chartPickerWindow) return;
  void prewarmChartPickerWindow().catch((error) => {
    prewarmPickerWindowDone = false;
    prewarmPickerWindowPromise = null;
    if (isTransientDaemonFetchError(error)) return;
    console.warn("[chart-picker-window-prewarm]", error);
  });
}

function parseCssRgb(value?: string): [number, number, number] | undefined {
  const match = value?.match(/rgb\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)/i);
  if (!match) return undefined;
  const rgb = match.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))));
  return [rgb[0], rgb[1], rgb[2]] as [number, number, number];
}

function nativeThemePayload(theme: ThemeState | null | undefined): {
  theme?: "light" | "dark";
  background?: [number, number, number];
} {
  const current = theme ?? getCachedThemeState();
  return {
    theme: current?.mode,
    background: parseCssRgb(
      current?.appTokens["--aries-background"] ?? current?.appTokens["--background"],
    ),
  };
}

async function prewarmChartPickerWindow(): Promise<void> {
  const shellHost = resolveShellHost();
  if (!shellHost.capabilities.chartPickerWindow || prewarmPickerWindowDone) return;
  if (prewarmPickerWindowPromise) return prewarmPickerWindowPromise;
  prewarmPickerWindowPromise = (async () => {
    const startedAt = perfNow();
    const [theme] = await Promise.all([
      ensureThemeStateCached(),
      loadChartPickerRows(false),
    ]);
    await shellHost.prewarmChartPickerWindow({
      path: "/chart-picker?mode=open-radix",
      title: "Open Horoscope",
      ...nativeThemePayload(theme),
    });
    prewarmPickerWindowDone = true;
    recordChartPerf("chart-picker-window-prewarm", {
      ms: perfNow() - startedAt,
    });
  })().finally(() => {
    prewarmPickerWindowPromise = null;
  });
  return prewarmPickerWindowPromise;
}

function openBrowserPicker(path: string, title: string): boolean {
  const target = window.open(path, "chart-picker", "popup,width=760,height=660");
  if (!target) {
    window.location.assign(path);
    return true;
  }
  target.document.title = title;
  target.focus();
  return true;
}

export async function openChartPickerWindow({
  mode,
  parentRadixId,
  excludeNames = [],
}: ChartPickerWindowParams): Promise<boolean> {
  try {
    const params = new URLSearchParams({ mode });
    if (parentRadixId) params.set("parentRadixId", parentRadixId);
    if (excludeNames.length) params.set("exclude", excludeNames.join("\n"));

    const path = `/chart-picker?${params.toString()}`;
    const title = mode === "synastry-partner" ? "Pick Synastry Partner" : "Open Horoscope";
    const rowsStartedAt = perfNow();
    const themePromise = ensureThemeStateCached().catch((error) => {
      if (isTransientDaemonFetchError(error)) return null;
      console.warn("[chart-picker-window-theme]", error);
      return null;
    });
    await loadChartPickerRows(true)
      .then((payload) => {
        recordChartPerf("chart-picker-window-rows", {
          rows: payload.rows.length,
          ms: perfNow() - rowsStartedAt,
        });
      })
      .catch((error) => {
        if (!isTransientDaemonFetchError(error)) {
          console.warn("[chart-picker-window-rows]", error);
        }
        recordChartPerf("chart-picker-window-rows", {
          failed: true,
          ms: perfNow() - rowsStartedAt,
        });
      });
    const theme = await themePromise;

    const shellHost = resolveShellHost();
    if (!shellHost.capabilities.chartPickerWindow) {
      return openBrowserPicker(path, title);
    }

    try {
      const startedAt = perfNow();
      await shellHost.openChartPickerWindow({
        path,
        title,
        ...nativeThemePayload(theme),
      });
      recordChartPerf("chart-picker-window-open", {
        runtime: "tauri",
        ms: perfNow() - startedAt,
      });
      return true;
    } catch (commandError) {
      console.warn("[chart-picker-window] Tauri command failed, trying JS window API", commandError);
    }

    // Fallback for older/pre-reload Tauri builds that do not expose the Rust command yet.
    await shellHost.openChartPickerWindowFallback({
      path,
      title,
      ...nativeThemePayload(theme),
    });
    return true;
  } catch (error) {
    console.error("[chart-picker-window] failed to open", error);
    return false;
  }
}
