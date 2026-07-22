// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useLayoutEffect, type ReactNode } from "react";

import { migrateLegacyStyleTokens, type ThemeState } from "@/lib/daemon/client";
import {
  loadStoredStyleLabFonts,
  STYLE_FONT_ASSETS_READY_EVENT,
} from "@/lib/style-lab/fonts";
import {
  LEGACY_STYLE_TOKEN_MIGRATION_ACK_KEY,
  LEGACY_STYLE_TOKEN_STORAGE_KEY,
  THEME_STATE_STORAGE_KEY,
} from "@/lib/theme/constants";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { syncThemeStateFromStorage, useThemeStore } from "@/stores/theme-store";

let appliedThemeTokenNames = new Set<string>();

function pendingLegacyStyleMigration(): { raw: string; values: Record<string, unknown> } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LEGACY_STYLE_TOKEN_STORAGE_KEY);
  if (!raw || window.localStorage.getItem(LEGACY_STYLE_TOKEN_MIGRATION_ACK_KEY) === raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const state = parsed?.state && typeof parsed.state === "object"
      ? parsed.state as Record<string, unknown>
      : parsed;
    const values = state?.values && typeof state.values === "object"
      ? state.values as Record<string, unknown>
      : state;
    if (!values || typeof values !== "object" || Array.isArray(values)) return null;
    return { raw, values };
  } catch {
    return null;
  }
}

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
  root.dataset.presentationCursor = theme.presentationCursor === true ? "glow" : "system";
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
    const syncDaemonStyle = async () => {
      const legacy = pendingLegacyStyleMigration();
      if (legacy) {
        try {
          const migrated = await migrateLegacyStyleTokens(legacy.values, true, controller.signal);
          if (controller.signal.aborted) return;
          useThemeStore.getState().applyThemeState(migrated.themeState);
          // Preserve the source payload exactly; the separate acknowledgement
          // only prevents repeated idempotent POSTs after daemon confirmation.
          window.localStorage.setItem(LEGACY_STYLE_TOKEN_MIGRATION_ACK_KEY, legacy.raw);
          return;
        } catch (err) {
          if (controller.signal.aborted) return;
          console.error("[style-profile-migration]", err);
        }
      }
      await fetchThemeState(controller.signal);
    };
    void syncDaemonStyle();
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
    const appOverrides = theme?.profileOverrides.appTokens;
    const chartOverrides = theme?.profileOverrides.chartPalette;
    if (
      !appOverrides?.["--aries-font-ui"] &&
      !appOverrides?.["--aries-font-symbols"] &&
      !chartOverrides?.["--aries-wheel-font-text"] &&
      !chartOverrides?.["--aries-wheel-font-symbols"]
    ) {
      return undefined;
    }
    const controller = new AbortController();
    void loadStoredStyleLabFonts(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) {
          document.dispatchEvent(new Event(STYLE_FONT_ASSETS_READY_EVENT));
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error("[style-font-assets]", error);
      });
    return () => controller.abort();
  }, [
    theme?.profileOverrides.appTokens,
    theme?.profileOverrides.chartPalette,
    theme?.styleRevision,
  ]);

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
