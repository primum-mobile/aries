// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useEffect } from "react";
import type { ComponentProps } from "react";
import type { SettingsDialog } from "./settings-dialog";
import { resolveShellHost } from "@/lib/shell-host";
import { readSettingsContext, SETTINGS_REQUEST, SETTINGS_REPLY, SETTINGS_STATE, type SettingsRequest } from "@/lib/shell/settings-window";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";
import { flushWheelGeometry } from "@/lib/daemon/wheel-preset-sync";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";

type Props = Pick<ComponentProps<typeof SettingsDialog>, "onOptionsPatched" | "onSemanticProfileSelect" | "onSemanticProfilesCommitted">;

/** The main workspace remains the owner of chart-local presentation and queues. */
export function SettingsWindowBridge({ onOptionsPatched, onSemanticProfileSelect, onSemanticProfilesCommitted }: Props) {
  useEffect(() => {
    if (resolveShellHost().kind !== "tauri") return;
    let disposed = false;
    let listening = false;
    const cleanup: (() => void)[] = [];
    void import("@tauri-apps/api/event").then(async ({ listen, emitTo }) => {
      const publish = () => {
        if (listening) void emitTo("settings", SETTINGS_STATE, readSettingsContext());
      };
      const stop = await listen<SettingsRequest>(SETTINGS_REQUEST, async ({ payload: { id, action } }) => {
        try {
          let value: unknown;
          switch (action.kind) {
            case "prewarm": value = readSettingsContext(); break;
            case "context": listening = true; await flushWheelGeometry(); value = readSettingsContext(); break;
            case "inactive": listening = false; break;
            case "flush-wheel": await flushWheelGeometry(); break;
            case "options": onOptionsPatched?.(action.options); break;
            case "profile": value = await onSemanticProfileSelect(action.profileId); break;
            case "profiles-committed": onSemanticProfilesCommitted(action.payload); break;
            case "lens": useWorkspaceStore.getState().setInspectorLens(action.lens); break;
            case "dock": useFrameLayoutStore.getState().setPrimaryDirectionsSettingsDock(action.dock); break;
            case "end-theme-preview":
              await flushWheelGeometry();
              useChartStyleEditorStore.getState().setLiveAppThemePreview(false);
              break;
          }
          await emitTo("settings", SETTINGS_REPLY, { id, value });
        } catch (error) {
          await emitTo("settings", SETTINGS_REPLY, { id, error: String(error) });
        }
      });
      if (disposed) { stop(); return; }
      cleanup.push(stop);
      cleanup.push(useWorkspaceStore.subscribe((next, previous) => {
        if (next.inspectorLens !== previous.inspectorLens || next.packsVersion !== previous.packsVersion
          || next.semanticProfileVersion !== previous.semanticProfileVersion) publish();
      }));
      cleanup.push(useFrameLayoutStore.subscribe((next, previous) => {
        if (next.primaryDirectionsSettingsDock !== previous.primaryDirectionsSettingsDock) publish();
      }));
      cleanup.push(useDaemonWorkspaceStore.subscribe((next, previous) => {
        if (next.lastOptionsChange !== previous.lastOptionsChange) publish();
      }));
    }).catch(error => console.error("[settings-window-bridge]", error));
    return () => { disposed = true; cleanup.forEach(stop => stop()); };
  }, [onOptionsPatched, onSemanticProfileSelect, onSemanticProfilesCommitted]);
  return null;
}
