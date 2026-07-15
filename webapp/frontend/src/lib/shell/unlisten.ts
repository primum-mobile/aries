// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type ShellUnlisten = () => void | Promise<void>;

export function safeShellUnlisten(unlisten: ShellUnlisten | null | undefined): void {
  if (!unlisten) return;
  try {
    const result = unlisten();
    if (result && typeof result.then === "function") {
      void result.catch((error) => {
        console.warn("[shell-event-unlisten]", error);
      });
    }
  } catch (error) {
    // Tauri's injected bridge can throw during StrictMode/HMR teardown if the
    // listener has already disappeared from its internal registry.
    console.warn("[shell-event-unlisten]", error);
  }
}
