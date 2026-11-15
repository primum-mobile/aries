// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolveNativeShellPlatform, resolveShellHost } from "@/lib/shell-host";
import { recordStartupPerfOnce } from "@/lib/chart/perf";

type NativeWindowMode = "light" | "dark";
type NativeWindowAppearance = { theme: NativeWindowMode; background?: number[] };

/** Appearance the native main window was last given (startup reveal or sync). */
let nativeWindowKey: string | null = null;
/** A sync is in flight; the latest appearance is sent once it settles. */
let nativeWindowSyncing = false;

function nativeWindowAppearance(): NativeWindowAppearance {
  const root = document.documentElement;
  const color = getComputedStyle(document.body).backgroundColor;
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return {
    theme: root.style.colorScheme === "light" ? "light" : "dark",
    background: rgb ? rgb.slice(1, 4).map(value => Math.round(Number(value))) : undefined,
  };
}

function appearanceKey(appearance: NativeWindowAppearance): string {
  return `${appearance.theme}:${appearance.background?.join(",") ?? ""}`;
}

/** Tauri's hidden-until-ready startup pattern, after the complete theme commit. */
export async function revealMainWindow() {
  if (resolveShellHost().kind !== "tauri") return;
  const { invoke } = await import("@tauri-apps/api/core");
  const appearance = nativeWindowAppearance();
  nativeWindowKey = appearanceKey(appearance);
  await invoke("show_main_window", appearance);
  recordStartupPerfOnce("themed-window-shown", { styleHash: document.documentElement.dataset.styleHash });
}

/**
 * Windows draws the caption buttons in the main window's native theme, so a
 * light Aries theme on a dark window hides minimize/maximize/close, and on
 * Windows 11 their background is the DWM caption colour, which carries the
 * page background. Follows every Aries theme change after the reveal, not
 * only light/dark switches: two dark themes have different title-bar
 * colours. Call after the theme is committed to the document. One native
 * call at a time; a burst of live colour previews sends only the latest
 * appearance. macOS keeps its startup appearance.
 */
export function syncMainWindowTheme(): void {
  if (nativeWindowKey === null || nativeWindowSyncing) return;
  if (resolveNativeShellPlatform() !== "windows") return;
  const appearance = nativeWindowAppearance();
  const key = appearanceKey(appearance);
  if (key === nativeWindowKey) return;
  nativeWindowKey = key;
  nativeWindowSyncing = true;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("set_main_window_theme", appearance))
    .catch(error => console.error("[main-window-theme]", error))
    .finally(() => {
      nativeWindowSyncing = false;
      // The theme may have changed again while the call was in flight.
      syncMainWindowTheme();
    });
}
