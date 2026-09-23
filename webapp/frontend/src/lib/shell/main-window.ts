// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolveShellHost } from "@/lib/shell-host";
import { recordStartupPerfOnce } from "@/lib/chart/perf";

/** Tauri's hidden-until-ready startup pattern, after the complete theme commit. */
export async function revealMainWindow() {
  if (resolveShellHost().kind !== "tauri") return;
  const { invoke } = await import("@tauri-apps/api/core");
  const root = document.documentElement;
  const color = getComputedStyle(document.body).backgroundColor;
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  await invoke("show_main_window", {
    theme: root.style.colorScheme === "light" ? "light" : "dark",
    background: rgb ? rgb.slice(1, 4).map(value => Math.round(Number(value))) : undefined,
  });
  recordStartupPerfOnce("themed-window-shown", { styleHash: root.dataset.styleHash });
}
