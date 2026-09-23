// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ThemeState } from "@/lib/daemon/client";

export const THEME_WINDOW_STATE = "aries://theme-window-state";
export const THEME_WINDOW_REQUEST = "aries://theme-window-request";

export type LiveThemePreview = Readonly<{
  sourceThemeName: string;
  mode: "light" | "dark";
  appTokens: Readonly<Record<string, string>>;
  chartPalette: Readonly<Record<string, string>>;
  appAuthoring: Readonly<Record<string, unknown>>;
}>;

/** Only appearance crosses windows, never the editor history or chart data. */
export type WindowThemeAppearance = {
  preset: string;
  mode: "light" | "dark";
  appTokens: Readonly<Record<string, string>>;
  chartPalette: Readonly<Record<string, string>>;
  appAuthoring: Readonly<Record<string, unknown>>;
  version: number;
  schemaVersion: number;
  styleRevision: number;
  styleHash: string;
  presentationCursor: boolean;
  preview: boolean;
};

export function resolveWindowThemeAppearance(theme: ThemeState, preview?: LiveThemePreview): WindowThemeAppearance {
  return {
    preset: preview?.sourceThemeName ?? theme.activePreset,
    mode: preview?.mode ?? theme.mode,
    appTokens: preview?.appTokens ?? theme.appTokens,
    chartPalette: preview?.chartPalette ?? theme.chartPalette,
    appAuthoring: preview?.appAuthoring ?? theme.profileOverrides.appAuthoring,
    version: theme.version,
    schemaVersion: theme.schemaVersion,
    styleRevision: theme.styleRevision,
    styleHash: theme.styleHash,
    presentationCursor: theme.presentationCursor === true,
    preview: Boolean(preview),
  };
}

/** Serialize IPC sends and keep only the newest pending colour-picker update. */
export function createThemeWindowPublisher(
  send: (appearance: WindowThemeAppearance) => Promise<void>,
  onError: (error: unknown) => void,
) {
  let pending: WindowThemeAppearance | null = null;
  let sending = false;
  let stopped = false;
  async function drain() {
    sending = true;
    try {
      while (!stopped && pending) {
        const appearance = pending;
        pending = null;
        try { await send(appearance); } catch (error) { onError(error); }
      }
    } finally { sending = false; }
  }
  return {
    publish(appearance: WindowThemeAppearance) {
      if (stopped) return;
      pending = appearance;
      if (!sending) void drain();
    },
    dispose() { stopped = true; pending = null; },
  };
}
