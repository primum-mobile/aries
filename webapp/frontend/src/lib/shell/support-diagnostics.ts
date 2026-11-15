// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Support diagnostics for the Windows desktop app. A tester's diagnostics are
// the main signal from that platform.
// The native shell (src-tauri/src/diagnostics.rs) gathers the system facts and
// log tails and redacts the report; this module adds what only the webview
// knows and forwards uncaught page errors to the shell log. macOS keeps its
// native menu and does not offer these commands.

import { fetchAbout } from "@/lib/daemon/client";
import { resolveNativeShellPlatform, resolveShellHost } from "@/lib/shell-host";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";

/** Help-menu commands added where the desktop app draws its own menu. */
export const SUPPORT_DIAGNOSTICS_COMMAND = "menu.help.diagnostics";
export const SUPPORT_OPEN_LOGS_COMMAND = "menu.help.open-logs";
export const SUPPORT_COMMANDS: readonly string[] = [
  SUPPORT_DIAGNOSTICS_COMMAND,
  SUPPORT_OPEN_LOGS_COMMAND,
];

export const DAEMON_STARTUP_FAILED_EVENT = "aries://daemon-startup-failed";
export const DAEMON_STARTUP_RECOVERED_EVENT = "aries://daemon-startup-recovered";

/** The native shell's report of an engine that could not start. */
export type DaemonStartupFailure = {
  reason: "spawn" | "exited" | "timeout" | string;
  exitCode: number | null;
  detail: string | null;
  /** For `spawn`: the engine file is missing/damaged, or Windows blocked it. */
  cause?: "missing" | "blocked" | string | null;
  logDir: string | null;
};

/**
 * Why the engine did not start. A spawn error names its likely cause when the
 * shell recognised the Windows error: the file is missing or quarantined, or
 * Windows (Smart App Control, security software, policy) blocked it.
 */
export function startupFailureMessage(t: (key: string) => string, failure: DaemonStartupFailure): string {
  if (failure.reason === "spawn") {
    if (failure.cause === "missing") return t("supportDiagnostics.startupSpawnMissing");
    if (failure.cause === "blocked") return t("supportDiagnostics.startupSpawnBlocked");
    return t("supportDiagnostics.startupSpawn");
  }
  return failure.reason === "timeout"
    ? t("supportDiagnostics.startupTimeout")
    : t("supportDiagnostics.startupExited");
}

/** Facts only the webview knows; the shell redacts the whole report. */
export type FrontendDiagnosticsFacts = {
  appVersion?: string;
  buildStamp?: string;
  swissEphemeris?: string;
  uiLanguage?: string;
  navigatorLanguages: string[];
  devicePixelRatio?: number;
  screen?: string;
  daemonConnection?: string;
  userAgent?: string;
};

/** True in the Windows desktop app, the only host that offers these tools. */
export function supportDiagnosticsAvailable(): boolean {
  return resolveShellHost().kind === "tauri" && resolveNativeShellPlatform() === "windows";
}

const ABOUT_TIMEOUT_MS = 1_500;

async function aboutFacts(): Promise<Partial<FrontendDiagnosticsFacts>> {
  if (useDaemonWorkspaceStore.getState().connection !== "open") return {};
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ABOUT_TIMEOUT_MS);
  try {
    const about = await fetchAbout(controller.signal);
    return {
      appVersion: about.version,
      buildStamp: about.buildStamp ?? undefined,
      swissEphemeris: about.swissEphemerisVersion || undefined,
    };
  } catch {
    // The engine may be the thing that is broken; report without it.
    return {};
  } finally {
    window.clearTimeout(timer);
  }
}

export async function gatherFrontendFacts(uiLanguage: string): Promise<FrontendDiagnosticsFacts> {
  const about = await aboutFacts();
  return {
    ...about,
    uiLanguage,
    navigatorLanguages: [...(navigator.languages ?? [navigator.language])].slice(0, 6),
    devicePixelRatio: window.devicePixelRatio,
    screen: `${window.screen.width}x${window.screen.height}, window ${window.innerWidth}x${window.innerHeight}`,
    daemonConnection: useDaemonWorkspaceStore.getState().connection,
    userAgent: navigator.userAgent,
  };
}

async function invokeShell<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function collectDiagnostics(uiLanguage: string): Promise<string> {
  return invokeShell<string>("collect_diagnostics", { facts: await gatherFrontendFacts(uiLanguage) });
}

export async function copyDiagnostics(uiLanguage: string): Promise<void> {
  await invokeShell<void>("copy_diagnostics", { facts: await gatherFrontendFacts(uiLanguage) });
}

/** Resolves to the saved path, or `null` when the user cancelled. */
export async function saveDiagnostics(uiLanguage: string): Promise<string | null> {
  return invokeShell<string | null>("save_diagnostics", { facts: await gatherFrontendFacts(uiLanguage) });
}

export async function openLogsFolder(): Promise<void> {
  await invokeShell<void>("open_logs_folder");
}

export async function fetchDaemonStartupFailure(): Promise<DaemonStartupFailure | null> {
  return invokeShell<DaemonStartupFailure | null>("get_daemon_startup_failure");
}

/** Subscribes to the shell's startup failure/recovery events. */
export async function subscribeDaemonStartup(
  onFailure: (failure: DaemonStartupFailure) => void,
  onRecovered: () => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const stopFailure = await listen<DaemonStartupFailure>(DAEMON_STARTUP_FAILED_EVENT, (event) =>
    onFailure(event.payload),
  );
  const stopRecovered = await listen(DAEMON_STARTUP_RECOVERED_EVENT, () => onRecovered());
  return () => {
    stopFailure();
    stopRecovered();
  };
}

/** One line for the shell log: message, source location and stack. */
export function describePageError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? fallback;
  } catch {
    return fallback;
  }
}

let pageErrorForwardingInstalled = false;

/** Windows: uncaught page errors and rejections go to aries-shell.log. */
export function installPageErrorForwarding(): void {
  if (pageErrorForwardingInstalled || !supportDiagnosticsAvailable()) return;
  pageErrorForwardingInstalled = true;
  const forward = (message: string) => {
    void invokeShell<void>("record_frontend_error", { message }).catch(() => undefined);
  };
  window.addEventListener("error", (event) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    forward(`page error${where}: ${describePageError(event.error, event.message)}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    forward(`unhandled rejection: ${describePageError(event.reason, "unknown reason")}`);
  });
}
