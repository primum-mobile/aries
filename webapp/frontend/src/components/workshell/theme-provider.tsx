// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { migrateLegacyStyleTokens, waitForDaemonStartup, type ThemeState } from "@/lib/daemon/client";
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
import { useColorSettingsPreviewStore } from "@/stores/color-settings-preview-store";
import { settingsColorPreviewMatchesTheme, withSettingsColorPreview } from "@/lib/chart/palette";
import { replaceThemeTokens, styleRevisionKey } from "@/lib/theme/style-state.mjs";
import { revealMainWindow } from "@/lib/shell/main-window";
import { useLicenseStateStore } from "@/stores/license-state-store";
import { resolveShellHost } from "@/lib/shell-host";
import {
  createThemeWindowPublisher,
  resolveWindowThemeAppearance,
  THEME_WINDOW_REQUEST,
  THEME_WINDOW_STATE,
  type LiveThemePreview,
  type WindowThemeAppearance,
} from "@/lib/shell/theme-window-sync";

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

let installedMaterialSignature: string | null = null;

function applyThemeToRoot(appearance: WindowThemeAppearance): void {
  const root = document.documentElement;
  const { appTokens, chartPalette, mode } = appearance;
  replaceThemeTokens(root, { ...appTokens, ...chartPalette });
  root.style.colorScheme = mode;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("day", mode === "light");
  root.dataset.themePreset = appearance.preset;
  if (appearance.preview) root.dataset.styleLabThemePreview = "active";
  else delete root.dataset.styleLabThemePreview;
  root.dataset.themeVersion = String(appearance.version);
  root.dataset.styleSchemaVersion = String(appearance.schemaVersion);
  root.dataset.styleRevision = String(appearance.styleRevision);
  root.dataset.styleHash = appearance.styleHash;
  root.dataset.presentationCursor = appearance.presentationCursor ? "glow" : "system";
  const materialSignature = JSON.stringify([appearance.appAuthoring, appTokens]);
  if (installedMaterialSignature !== materialSignature) {
    try {
      installAppMaterialStyleSheet(
        compileThemeAppMaterials(
          appearance.appAuthoring,
          appTokens,
        ),
      );
    } catch (error) {
      // A stale browser cache degrades to the semantic solid palette.
      console.error("[app-material-theme]", error);
      installAppMaterialStyleSheet(compileThemeAppMaterials({}, appTokens));
    }
    installedMaterialSignature = materialSignature;
  }
  root.dataset.themeReady = "ready";
}

export function ThemeProvider({ children, mainWindow = false }: { children: ReactNode; mainWindow?: boolean }) {
  const [startupSettled, setStartupSettled] = useState(false);
  const revealed = useRef(false);
  const [remoteAppearance, setRemoteAppearance] = useState<WindowThemeAppearance | null>(null);
  const remoteStyleKey = remoteAppearance ? styleRevisionKey(remoteAppearance) : null;
  const latestAppearance = useRef<WindowThemeAppearance | null>(null);
  const publishAppearance = useRef<((appearance: WindowThemeAppearance) => void) | null>(null);
  const requestAppearance = useRef<(() => void) | null>(null);
  const licenseNeedsInput = useLicenseStateStore((state) => Boolean(
    state.status?.required && !["active", "grace"].includes(state.status.state),
  ));
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
  const settingsColorPreview = useColorSettingsPreviewStore((state) => state.color);

  useEffect(() => {
    if (mainWindow && settingsColorPreviewMatchesTheme(theme, settingsColorPreview)) {
      useColorSettingsPreviewStore.getState().setColor(null);
    }
  }, [mainWindow, settingsColorPreview, theme]);

  useEffect(() => {
    if (resolveShellHost().kind !== "tauri") return;
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const report = (error: unknown) => console.error("[theme-window-sync]", error);
    void import("@tauri-apps/api/event").then(async ({ emit, emitTo, listen }) => {
      if (disposed) return;
      if (mainWindow) {
        const publisher = createThemeWindowPublisher(
          appearance => emit(THEME_WINDOW_STATE, appearance), report,
        );
        cleanup.push(() => publisher.dispose());
        publishAppearance.current = publisher.publish;
        const sendLatest = () => {
          if (latestAppearance.current) publisher.publish(latestAppearance.current);
        };
        const stop = await listen(THEME_WINDOW_REQUEST, sendLatest);
        if (disposed) { stop(); return; }
        cleanup.push(stop);
        sendLatest();
      } else {
        // Subscribe before requesting the current appearance, including live
        // drafts. Hidden retained windows stay subscribed and paint in place.
        const stop = await listen<WindowThemeAppearance>(THEME_WINDOW_STATE, ({ payload }) => {
          if (!disposed) setRemoteAppearance(payload);
        });
        if (disposed) { stop(); return; }
        cleanup.push(stop);
        requestAppearance.current = () => { void emitTo("main", THEME_WINDOW_REQUEST).catch(report); };
        requestAppearance.current();
      }
    }).catch(report);
    return () => {
      disposed = true;
      publishAppearance.current = null;
      requestAppearance.current = null;
      cleanup.forEach(stop => stop());
    };
  }, [mainWindow]);

  if (mainWindow && licenseNeedsInput && !startupSettled) setStartupSettled(true);
  useEffect(() => {
    if (mainWindow && licenseNeedsInput) return;
    // Always reconcile on mount, including companion windows without a
    // workspace socket. Cached paint is not a completed daemon bootstrap.
    const controller = new AbortController();
    const restoreWorkingTheme = async (next: ThemeState | null) => {
      // Native companions mirror the main window's resolved appearance. A
      // recovered local draft would otherwise keep masking later theme changes.
      if (!mainWindow && resolveShellHost().kind === "tauri") return;
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
          chartData: next.profileOverrides.chartData,
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
      // Reuse the app's existing shared startup wait; a slow sidecar must not
      // briefly reveal yesterday's cache before today's theme is available.
      if (mainWindow) await waitForDaemonStartup(controller.signal);
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
    void syncDaemonStyle().catch(error => {
      if (!controller.signal.aborted) console.error("[theme-startup]", error);
    }).finally(() => {
      // A daemon/license failure must still leave its recovery UI accessible.
      if (!controller.signal.aborted) setStartupSettled(true);
    });
    return () => controller.abort();
  }, [connection, fetchThemeState, mainWindow, licenseNeedsInput]);

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
      requestAppearance.current?.();
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

  useEffect(() => {
    if (!remoteStyleKey || !startupSettled) return;
    const current = useThemeStore.getState().theme;
    if (styleRevisionKey(current) === remoteStyleKey) return;
    // Refresh canonical consumers only when the saved theme changed. Live
    // colour/material previews repaint directly and never refetch options.
    const controller = new AbortController();
    void fetchThemeState(controller.signal);
    return () => controller.abort();
  }, [fetchThemeState, startupSettled, remoteStyleKey]);

  useLayoutEffect(() => {
    if (remoteAppearance) {
      applyThemeToRoot(remoteAppearance);
      return;
    }
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
        } satisfies LiveThemePreview
      : undefined;
    const appearance = resolveWindowThemeAppearance(
      withSettingsColorPreview(theme, settingsColorPreview) ?? theme,
      preview,
    );
    applyThemeToRoot(appearance);
    // Do not push yesterday's boot cache into already-mounted companions while
    // the main window is still reconciling its daemon theme and working draft.
    if (mainWindow && startupSettled) {
      latestAppearance.current = appearance;
      publishAppearance.current?.(appearance);
    }
  }, [
    mainWindow,
    startupSettled,
    remoteAppearance,
    liveAppThemePreview,
    styleLabBaseTheme,
    styleLabCssOverrides,
    styleLabRevision,
    styleLabSemanticOverrides,
    settingsColorPreview,
    theme,
  ]);

  useLayoutEffect(() => {
    if (!mainWindow || !startupSettled || revealed.current) return;
    revealed.current = true;
    if (!theme) document.documentElement.dataset.themeReady = "fallback";
    // Runs after the palette and material stylesheet commit above.
    void revealMainWindow().catch(error => console.error("[main-window-ready]", error));
  }, [mainWindow, startupSettled, theme]);

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
