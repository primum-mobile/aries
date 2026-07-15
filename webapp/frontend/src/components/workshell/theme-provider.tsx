// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useLayoutEffect, type ReactNode } from "react";

import type { ThemeState } from "@/lib/daemon/client";
import { THEME_STATE_STORAGE_KEY } from "@/lib/theme/constants";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { syncThemeStateFromStorage, useThemeStore } from "@/stores/theme-store";

let appliedThemeTokenNames = new Set<string>();

function applyThemeToRoot(theme: ThemeState): void {
  const root = document.documentElement;
  const tokens = { ...theme.appTokens, ...theme.chartPalette };
  const nextTokenNames = new Set(Object.keys(tokens));
  for (const name of appliedThemeTokenNames) {
    if (!nextTokenNames.has(name)) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
  appliedThemeTokenNames = nextTokenNames;
  root.style.colorScheme = theme.mode;
  root.classList.toggle("dark", theme.mode === "dark");
  root.classList.toggle("day", theme.mode === "light");
  root.dataset.themePreset = theme.activePreset;
  root.dataset.themeVersion = String(theme.version);
  root.dataset.styleSchemaVersion = String(theme.schemaVersion);
  root.dataset.styleRevision = String(theme.styleRevision);
  root.dataset.styleHash = theme.styleHash;
  root.dataset.themeReady = "ready";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  const fetchThemeState = useThemeStore((state) => state.fetchThemeState);
  const connection = useDaemonWorkspaceStore((state) => state.connection);
  const optionsChange = useDaemonWorkspaceStore((state) => state.lastOptionsChange);

  useEffect(() => {
    if (syncThemeStateFromStorage()) return undefined;
    const controller = new AbortController();
    void fetchThemeState(controller.signal);
    return () => controller.abort();
  }, [fetchThemeState]);

  useEffect(() => {
    if (connection !== "open") return;
    const controller = new AbortController();
    void fetchThemeState(controller.signal);
    return () => controller.abort();
  }, [connection, fetchThemeState]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let fetchController: AbortController | null = null;

    const syncOrFetch = () => {
      if (syncThemeStateFromStorage()) return;
      fetchController?.abort();
      fetchController = new AbortController();
      void fetchThemeState(fetchController.signal);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STATE_STORAGE_KEY) syncOrFetch();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") syncOrFetch();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", syncOrFetch);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      fetchController?.abort();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncOrFetch);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchThemeState]);

  useLayoutEffect(() => {
    if (!theme) return;
    applyThemeToRoot(theme);
  }, [theme]);

  useEffect(() => {
    if (!optionsChange) return;
    const current = useThemeStore.getState().theme;
    if (
      current?.schemaVersion === optionsChange.schemaVersion &&
      current.styleRevision === optionsChange.styleRevision &&
      current.styleHash === optionsChange.styleHash
    ) {
      return;
    }

    const controller = new AbortController();
    void fetchThemeState(controller.signal);
    return () => controller.abort();
  }, [fetchThemeState, optionsChange]);

  return children;
}
