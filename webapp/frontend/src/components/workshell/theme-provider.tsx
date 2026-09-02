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
  APP_AUTHORING_OVERRIDE_PREFIX,
  fetchWorkingStyleLabDraft,
  StyleLabApiError,
} from "@/lib/style-lab/client";
import {
  LEGACY_STYLE_TOKEN_MIGRATION_ACK_KEY,
  LEGACY_STYLE_TOKEN_STORAGE_KEY,
  THEME_STATE_STORAGE_KEY,
} from "@/lib/theme/constants";
import {
  compileThemeAppMaterials,
  installAppMaterialStyleSheet,
} from "@/lib/theme/app-material-runtime";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";
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

type LiveStyleLabThemePreview = Readonly<{
  sourceThemeName: string;
  mode: "light" | "dark";
  appTokens: Readonly<Record<string, string>>;
  chartPalette: Readonly<Record<string, string>>;
  appAuthoring: Readonly<Record<string, unknown>>;
}>;

function applyThemeToRoot(
  theme: ThemeState,
  preview?: LiveStyleLabThemePreview,
): void {
  const root = document.documentElement;
  const appTokens = preview?.appTokens ?? theme.appTokens;
  const chartPalette = preview?.chartPalette ?? theme.chartPalette;
  const tokens = { ...appTokens, ...chartPalette };
  const nextTokenNames = new Set(Object.keys(tokens));
  for (const name of appliedThemeTokenNames) {
    if (!nextTokenNames.has(name)) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
  appliedThemeTokenNames = nextTokenNames;
  const mode = preview?.mode ?? theme.mode;
  root.style.colorScheme = mode;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("day", mode === "light");
  root.dataset.themePreset = preview?.sourceThemeName ?? theme.activePreset;
  if (preview) root.dataset.styleLabThemePreview = "active";
  else delete root.dataset.styleLabThemePreview;
  root.dataset.themeVersion = String(theme.version);
  root.dataset.styleSchemaVersion = String(theme.schemaVersion);
  root.dataset.styleRevision = String(theme.styleRevision);
  root.dataset.styleHash = theme.styleHash;
  root.dataset.presentationCursor = theme.presentationCursor === true ? "glow" : "system";
  root.dataset.themeReady = "ready";
  try {
    installAppMaterialStyleSheet(
      compileThemeAppMaterials(
        preview?.appAuthoring ?? theme.profileOverrides.appAuthoring,
        appTokens,
      ),
    );
  } catch (error) {
    // Daemon profiles are validated before ThemeState publication. A stale
    // browser cache still degrades to the semantic solid palette instead of
    // leaving the retained app shell partially styled.
    console.error("[app-material-theme]", error);
    installAppMaterialStyleSheet(
      compileThemeAppMaterials({}, appTokens),
    );
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  const fetchThemeState = useThemeStore((state) => state.fetchThemeState);
  const connection = useDaemonWorkspaceStore((state) => state.connection);
  const optionsChange = useDaemonWorkspaceStore((state) => state.lastOptionsChange);
  const liveAppThemePreview = useChartStyleEditorStore(
    (state) => state.liveAppThemePreview,
  );
  const styleLabBaseTheme = useChartStyleEditorStore(
    (state) => state.styleLabBaseTheme,
  );
  const styleLabCssOverrides = useChartStyleEditorStore(
    (state) => state.cssOverrides,
  );
  const styleLabSemanticOverrides = useChartStyleEditorStore(
    (state) => state.resolvedOverrides,
  );
  const styleLabRevision = useChartStyleEditorStore((state) => state.revision);

  useEffect(() => {
    if (syncThemeStateFromStorage()) return undefined;
    const controller = new AbortController();
    void fetchThemeState(controller.signal);
    return () => controller.abort();
  }, [fetchThemeState]);

  useEffect(() => {
    if (connection !== "open") return;
    const controller = new AbortController();
    const restoreWorkingTheme = async (next: ThemeState | null) => {
      if (!next?.activePreset || controller.signal.aborted) return;
      try {
        const draft = await fetchWorkingStyleLabDraft(
          next.activePreset,
          controller.signal,
        );
        if (controller.signal.aborted || !draft.modifiedFromBaseline) return;
        // Keep the sizeable editor catalog and colour parser out of ordinary
        // app startup. They are needed only when recovery actually found a
        // working draft to resolve.
        const { STYLE_LAB_TOKEN_METADATA } = await import(
          "@/lib/style-lab/token-metadata"
        );
        if (controller.signal.aborted) return;
        const editor = useChartStyleEditorStore.getState();
        editor.setTokenMetadata(STYLE_LAB_TOKEN_METADATA);
        editor.setStyleLabBaseTheme({
          sourceThemeName: next.activePreset,
          mode: next.mode,
          appTokens: next.appTokens,
          chartPalette: next.chartPalette,
          appAuthoring: next.profileOverrides.appAuthoring,
        });
        editor.acceptRemoteDraft(draft, { clearHistory: true });
        editor.setLiveAppThemePreview(true);
      } catch (error) {
        if (
          controller.signal.aborted
          || (error instanceof StyleLabApiError && error.status === 404)
        ) return;
        // Recovery is a convenience layer; the saved daemon theme remains the
        // safe paint if its small journal is temporarily unavailable.
        console.error("[style-draft-recovery]", error);
      }
    };
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
          await restoreWorkingTheme(migrated.themeState);
          return;
        } catch (err) {
          if (controller.signal.aborted) return;
          console.error("[style-profile-migration]", err);
        }
      }
      await restoreWorkingTheme(await fetchThemeState(controller.signal));
    };
    void syncDaemonStyle();
    return () => controller.abort();
  }, [connection, fetchThemeState]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let fetchController: AbortController | null = null;

    const syncOrFetch = () => {
      // The cache is a paint optimisation, not authority. Repaint from it at
      // once so there is no flash, then always reconcile against the daemon:
      // returning early here left these listeners unable to see any theme
      // change this client did not itself write, which is what they exist for.
      // applyThemeState no-ops when styleRevision and styleHash already match,
      // so an unchanged theme costs one request and no repaint.
      syncThemeStateFromStorage();
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
    const preview = liveAppThemePreview && styleLabBaseTheme.sourceThemeName
      ? {
          sourceThemeName: styleLabBaseTheme.sourceThemeName,
          mode: styleLabBaseTheme.mode,
          appTokens: {
            ...styleLabBaseTheme.appTokens,
            ...styleLabCssOverrides,
          },
          chartPalette: {
            ...styleLabBaseTheme.chartPalette,
            ...styleLabCssOverrides,
          },
          appAuthoring: {
            ...styleLabBaseTheme.appAuthoring,
            ...Object.fromEntries(
              Object.entries(styleLabSemanticOverrides).filter(([semanticId]) =>
                semanticId.startsWith(APP_AUTHORING_OVERRIDE_PREFIX)
              ),
            ),
          },
        } satisfies LiveStyleLabThemePreview
      : undefined;
    applyThemeToRoot(theme, preview);
  }, [
    liveAppThemePreview,
    styleLabBaseTheme,
    styleLabCssOverrides,
    styleLabRevision,
    styleLabSemanticOverrides,
    theme,
  ]);

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
