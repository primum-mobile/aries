// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useToolWindowIntent, useRevealToolWindow } from "@/lib/shell/tool-window-lifecycle";
import { SettingsDialog, isSettingsTabId, type SettingsTabId } from "@/components/workshell/settings-dialog";
import { ThemeProvider } from "@/components/workshell/theme-provider";
import { hideNativeSettings, requestSettingsAction, SETTINGS_OPEN, SETTINGS_STATE, type SettingsContext } from "@/lib/shell/settings-window";
import type { CorpusSemanticProfilesPayload, OptionsPayload } from "@/lib/daemon/client";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useSyncLocale, useT } from "@/lib/i18n/i18n";
import { Dialog, NativeDialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const logFailure = (error: unknown) => console.error("[settings-window]", error);
const publishOptions = (options?: OptionsPayload) => { void requestSettingsAction({ kind: "options", options }).catch(logFailure); };
const publishProfiles = (payload: CorpusSemanticProfilesPayload) => { void requestSettingsAction({ kind: "profiles-committed", payload }).catch(logFailure); };
const flushSourceWheel = () => requestSettingsAction({ kind: "flush-wheel" });
const endThemePreview = () => requestSettingsAction({ kind: "end-theme-preview" });

export function SettingsRouteClient() {
  const intent = useToolWindowIntent<{tab?: string}>(SETTINGS_OPEN);
  const requestedTab = intent?.context?.tab;
  const [tab, setTab] = useState<SettingsTabId>("appearance");
  // Follow a *newly* requested tab only; comparing against `tab` would snap
  // every manual tab click back to the requested one.
  const [appliedRequestedTab, setAppliedRequestedTab] = useState<string>();
  if (requestedTab !== appliedRequestedTab) {
    setAppliedRequestedTab(requestedTab);
    if (requestedTab && isSettingsTabId(requestedTab)) setTab(requestedTab);
  }
  const open = intent?.open ?? false;
  const [readyGeneration, setReadyGeneration] = useState(-1);
  const [contextReady, setContextReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const visibleRef = useRef(open);
  useLayoutEffect(() => { visibleRef.current = open; }, [open]);
  const profileRevision = useRef(0);
  const syncLocale = useSyncLocale();
  const t = useT();

  useEffect(() => {
    let disposed = false;
    let applying = false;

    let optionsSeq: number | undefined;
    const cleanup: (() => void)[] = [];
    const applyContext = (context: SettingsContext) => {
      if (disposed) return;
      applying = true;
      try {
        useWorkspaceStore.setState({ inspectorLens: context.inspectorLens, packsVersion: context.packsVersion,
          semanticProfileVersion: context.semanticProfileVersion });
        useFrameLayoutStore.getState().setPrimaryDirectionsSettingsDock(context.primaryDirectionsSettingsDock);
        if (context.optionsChange && optionsSeq !== context.optionsChange.seq) {
          optionsSeq = context.optionsChange.seq;
          useDaemonWorkspaceStore.getState()._applyOptionsChange(context.optionsChange);
          syncLocale(context.optionsChange.langid);
        }
        setContextReady(true);
        setLoadError(false);
      } finally { applying = false; }
    };
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const stopState = await listen<SettingsContext>(SETTINGS_STATE, ({ payload }) => { if (visibleRef.current) applyContext(payload); });
      if (disposed) { stopState(); return; }
      cleanup.push(stopState);
      cleanup.push(useWorkspaceStore.subscribe((next, previous) => {
        if (!applying && next.inspectorLens !== previous.inspectorLens)
          void requestSettingsAction({ kind: "lens", lens: next.inspectorLens }).catch(logFailure);
      }));
      cleanup.push(useFrameLayoutStore.subscribe((next, previous) => {
        if (!applying && next.primaryDirectionsSettingsDock !== previous.primaryDirectionsSettingsDock)
          void requestSettingsAction({ kind: "dock", dock: next.primaryDirectionsSettingsDock }).catch(logFailure);
      }));
      await requestSettingsAction<SettingsContext>({ kind: open ? "context" : "prewarm" }).then(applyContext);
    }).catch(error => {
      if (disposed) return;
      logFailure(error);
      setLoadError(true);
    });
    return () => { disposed = true; cleanup.forEach(stop => stop()); };
    // On reopen the controls stay mounted while context is reconciled.
  }, [syncLocale, open]);

  useEffect(() => {
    void import("@/lib/shell-host").then(({ resolveShellHost }) => resolveShellHost().setWindowTitle(t("settings.title"))).catch(logFailure);
  }, [t]);

  const onReady = useCallback(() => setReadyGeneration(intent?.generation ?? -1), [intent?.generation]);
  useRevealToolWindow("show_settings_window", intent, loadError || readyGeneration === intent?.generation);
  const onOpenChange = useCallback((next: boolean) => {
    if (!next) void hideNativeSettings().catch(logFailure);
  }, []);
  useEffect(() => {
    if (!open) void requestSettingsAction({kind: "inactive"}).catch(logFailure);
  }, [open]);
  const selectProfile = useCallback((profileId: string) => {
    profileRevision.current += 1;
    return requestSettingsAction<CorpusSemanticProfilesPayload | null>({ kind: "profile", profileId });
  }, []);
  const getProfileRevision = useCallback(() => profileRevision.current, []);

  return <ThemeProvider>{loadError ? <Dialog open onOpenChange={onOpenChange} modal={false}>
    <NativeDialogContent className="flex flex-col">
      <DialogHeader data-tauri-drag-region=""><DialogTitle data-tauri-drag-region="">{t("settings.title")}</DialogTitle></DialogHeader>
      <p>{t("settings.loadFailed")}</p>
    </NativeDialogContent>
  </Dialog> : contextReady && <SettingsDialog nativeWindow open={open} initialTab={tab}
    onOpenChange={onOpenChange} onReady={onReady} onEndThemePreview={endThemePreview} onBeforeWheelAction={flushSourceWheel}
    onOptionsPatched={publishOptions} onSemanticProfileSelect={selectProfile}
    onSemanticProfilesCommitted={publishProfiles} getSemanticProfileRevision={getProfileRevision} />}</ThemeProvider>;
}
