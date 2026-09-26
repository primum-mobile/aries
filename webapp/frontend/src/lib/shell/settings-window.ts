// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OptionsPayload, CorpusSemanticProfilesPayload } from "@/lib/daemon/client";
import type { SettingsTabId } from "@/components/workshell/settings-dialog";
import { resolveShellHost } from "@/lib/shell-host";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { safeShellUnlisten } from "./unlisten";

export const SETTINGS_REQUEST = "aries://settings-request";
export const SETTINGS_REPLY = "aries://settings-reply";
export const SETTINGS_STATE = "aries://settings-state";
export const SETTINGS_OPEN = "aries://settings-open";
export const SETTINGS_WINDOW_WIDTH = 640;

export function readSettingsContext() {
  const workspace = useWorkspaceStore.getState();
  return {
    inspectorLens: workspace.inspectorLens,
    packsVersion: workspace.packsVersion,
    semanticProfileVersion: workspace.semanticProfileVersion,
    primaryDirectionsSettingsDock: useFrameLayoutStore.getState().primaryDirectionsSettingsDock,
    optionsChange: useDaemonWorkspaceStore.getState().lastOptionsChange,
  };
}
export type SettingsContext = ReturnType<typeof readSettingsContext>;
export type SettingsAction =
  | { kind: "context" }
  | { kind: "prewarm" }
  | { kind: "inactive" }
  | { kind: "options"; options?: OptionsPayload }
  | { kind: "profile"; profileId: string }
  | { kind: "profiles-committed"; payload: CorpusSemanticProfilesPayload }
  | { kind: "lens"; lens: SettingsContext["inspectorLens"] }
  | { kind: "dock"; dock: SettingsContext["primaryDirectionsSettingsDock"] }
  | { kind: "flush-wheel" }
  | { kind: "end-theme-preview" };
export type SettingsRequest = { id: string; action: SettingsAction };
type SettingsReply = { id: string; value?: unknown; error?: string };

export async function requestSettingsAction<T = void>(action: SettingsAction): Promise<T> {
  const { emitTo, listen } = await import("@tauri-apps/api/event");
  const id = crypto.randomUUID();
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Settings host did not respond")), 30_000);
      void listen<SettingsReply>(SETTINGS_REPLY, ({ payload }) => {
        if (payload.id !== id) return;
        if (payload.error) reject(new Error(payload.error));
        else resolve(payload.value as T);
      }).then((unlisten) => {
        if (done) { safeShellUnlisten(unlisten); return; }
        stop = unlisten;
        return emitTo("main", SETTINGS_REQUEST, { id, action } satisfies SettingsRequest);
      }).catch(reject);
    });
  } finally {
    done = true;
    clearTimeout(timer);
    safeShellUnlisten(stop);
  }
}

/** Seed the native host from the existing dialog's CSS budget; warm opens keep its frame. */
export async function openNativeSettings(tab: SettingsTabId, title: string): Promise<boolean> {
  if (resolveShellHost().kind !== "tauri") return false;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:min(var(--aries-dialog-viewport-width),calc(100vw - var(--aries-dialog-viewport-inset)),var(--aries-dialog-width-workspace));height:min(var(--aries-dialog-viewport-height),calc(var(--aries-dialog-content-height-workspace) + var(--aries-dialog-padding) + var(--aries-pane-header-padding-y) + var(--aries-font-size-large) + var(--aries-sash-rule-size)))";
  document.body.append(probe);
  const { height } = probe.getBoundingClientRect();
  probe.remove();
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_settings_window", { tab, title, width: SETTINGS_WINDOW_WIDTH, height });
  return true;
}

export async function hideNativeSettings() {
  if (resolveShellHost().kind !== "tauri") return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("hide_settings_window");
}
