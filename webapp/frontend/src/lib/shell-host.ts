// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type ShellHostKind = "tauri" | "browser";
export type NativeShellPlatform = "windows" | "macos" | "linux" | "other";

export type ShellMenuEnabledState = {
  id: string;
  enabled: boolean;
};

export type ShellMenuCheckedState = {
  id: string;
  checked: boolean;
};

export type ShellRecentChartEntry = {
  id: string;
  label: string;
};

export type ShellMenuLabelState = {
  id: string;
  label: string;
};

export type FrontendPerfEvent = {
  name: string;
  at: number;
  detail: Record<string, unknown>;
};

export type NativeDaemonResponse = {
  status: number;
  body: string;
  contentLength: number;
  transport: "unix-ipc" | "rust-http-fallback";
};

export type ShellMenuStateSnapshot = {
  enabled: Record<string, boolean>;
  checked: Record<string, boolean>;
};

export type ShellHostCapabilities = {
  nativeMenu: boolean;
  nativeFileDialogs: boolean;
  nativeWindowChrome: boolean;
  chartPickerWindow: boolean;
  crossWindowCommandAckOptional: boolean;
};

export type NativeChartPickerWindowOptions = {
  path: string;
  title: string;
  theme?: "light" | "dark";
  background?: [number, number, number];
};

export type NativeDialogFilter = {
  name: string;
  extensions: string[];
};

export type NativeOpenDialogOptions = {
  title?: string;
  directory?: boolean;
  multiple?: boolean;
  filters?: NativeDialogFilter[];
};

export type ShellPickedFile = {
  name: string;
  dataBase64: string;
  relativePath?: string;
};

export type ShellOpenSelection = {
  paths: string[];
  files: ShellPickedFile[];
};

export type NativeSaveDialogOptions = {
  title?: string;
  defaultPath?: string;
  filters?: NativeDialogFilter[];
};

export type ShellHost = {
  kind: ShellHostKind;
  capabilities: ShellHostCapabilities;
  closeChartPickerWindow: () => Promise<void>;
  confirmQuit: () => Promise<void>;
  copyImage: (bytes: Uint8Array, mimeType: string) => Promise<void>;
  downloadBytes: (filename: string, bytes: Uint8Array, mimeType: string) => Promise<void>;
  installBeforeUnloadGuard: (shouldBlock: () => boolean) => () => void;
  listenChartPickerWindowEvents: (
    onEvent: (payload: Record<string, unknown>) => void,
  ) => Promise<() => void>;
  listenMenuCommands: (onCommand: (command: string) => void) => Promise<() => void>;
  listenQuitRequested: (onRequest: () => void) => Promise<() => void>;
  openChartPickerWindow: (options: NativeChartPickerWindowOptions) => Promise<void>;
  openChartPickerWindowFallback: (options: NativeChartPickerWindowOptions) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  requestDaemon: (
    method: "GET" | "POST",
    path: string,
    body?: string,
  ) => Promise<NativeDaemonResponse | null>;
  prewarmNativeApi: () => Promise<void>;
  prewarmChartPickerWindow: (options: NativeChartPickerWindowOptions) => Promise<void>;
  recordFrontendPerf: (event: FrontendPerfEvent) => Promise<void>;
  restoreCurrentChartPickerWindow: () => Promise<void>;
  selectOpenFiles: (options: NativeOpenDialogOptions) => Promise<ShellOpenSelection>;
  selectOpenPaths: (options: NativeOpenDialogOptions) => Promise<string[]>;
  selectSavePath: (options: NativeSaveDialogOptions) => Promise<string | null>;
  closeCurrentChartPickerWindow: () => Promise<void>;
  setWindowTitle: (title: string, shouldApply?: () => boolean) => Promise<void>;
  syncMenuChecked: (states: ShellMenuCheckedState[]) => Promise<void>;
  syncMenuEnablement: (states: ShellMenuEnabledState[]) => Promise<void>;
  syncMenuLabels: (labels: ShellMenuLabelState[]) => Promise<void>;
  syncRecentCharts: (entries: ShellRecentChartEntry[]) => Promise<void>;
};

type TauriRuntimeWindow = Window & {
  __ARIES_TAURI_RUNTIME__?: boolean;
  __ARIES_NATIVE_PLATFORM__?: string;
  __ARIES_WINDOWS_CAPTION_INSET__?: number;
  __TAURI_INTERNALS__?: unknown;
  isTauri?: boolean;
};

type EyeDropperWindow = Window & {
  EyeDropper?: new () => {
    open: () => Promise<{ sRGBHex: string }>;
  };
};

function runtimeWindow(): TauriRuntimeWindow | null {
  return typeof window === "undefined" ? null : (window as TauriRuntimeWindow);
}

function hasTauriInternals(): boolean {
  const win = runtimeWindow();
  return (
    win?.__ARIES_TAURI_RUNTIME__ === true ||
    win?.isTauri === true ||
    win?.__TAURI_INTERNALS__ != null
  );
}

export function resolveNativeShellPlatform(): NativeShellPlatform | null {
  const platform = runtimeWindow()?.__ARIES_NATIVE_PLATFORM__;
  if (platform === "windows" || platform === "macos" || platform === "linux") {
    return platform;
  }
  return hasTauriInternals() ? "other" : null;
}

function browserEyeDropper(): EyeDropperWindow["EyeDropper"] {
  return typeof window === "undefined"
    ? undefined
    : (window as EyeDropperWindow).EyeDropper;
}

export function supportsScreenColorSampling(): boolean {
  return resolveNativeShellPlatform() === "macos" || browserEyeDropper() != null;
}

export async function sampleScreenColor(): Promise<string | null> {
  if (resolveNativeShellPlatform() === "macos") {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("sample_screen_color");
  }
  const EyeDropper = browserEyeDropper();
  if (!EyeDropper) {
    throw new Error("screen color sampling is unavailable");
  }
  const result = await new EyeDropper().open();
  return result.sRGBHex;
}

export function resolveWindowsCaptionInset(): number {
  const inset = runtimeWindow()?.__ARIES_WINDOWS_CAPTION_INSET__;
  return Number.isFinite(inset) && (inset ?? 0) > 0 ? Math.round(inset as number) : 0;
}

const emptyShellMenuState: ShellMenuStateSnapshot = { enabled: {}, checked: {} };
let browserShellMenuState: ShellMenuStateSnapshot = emptyShellMenuState;
const browserShellMenuListeners = new Set<() => void>();

function publishBrowserShellMenuState(next: ShellMenuStateSnapshot): void {
  browserShellMenuState = next;
  browserShellMenuListeners.forEach((listener) => listener());
}

function mirrorShellMenuChecked(states: ShellMenuCheckedState[]): void {
  if (states.length === 0) return;
  const checked = { ...browserShellMenuState.checked };
  for (const state of states) checked[state.id] = state.checked;
  publishBrowserShellMenuState({ ...browserShellMenuState, checked });
}

function mirrorShellMenuEnablement(states: ShellMenuEnabledState[]): void {
  if (states.length === 0) return;
  const enabled = { ...browserShellMenuState.enabled };
  for (const state of states) enabled[state.id] = state.enabled;
  publishBrowserShellMenuState({ ...browserShellMenuState, enabled });
}

export function subscribeShellMenuState(listener: () => void): () => void {
  browserShellMenuListeners.add(listener);
  return () => browserShellMenuListeners.delete(listener);
}

export function getShellMenuStateSnapshot(): ShellMenuStateSnapshot {
  return browserShellMenuState;
}

export function getServerShellMenuStateSnapshot(): ShellMenuStateSnapshot {
  return emptyShellMenuState;
}

function downloadBytesInBrowser(filename: string, bytes: Uint8Array, mimeType: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.trim() || "Aries";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyImageInBrowser(bytes: Uint8Array, mimeType: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("image clipboard is unavailable in this browser");
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const type = mimeType || "image/png";
  await navigator.clipboard.write([
    new ClipboardItem({ [type]: new Blob([buffer], { type }) }),
  ]);
}

function openDialogAccept(filters?: NativeDialogFilter[]): string {
  return (filters ?? [])
    .flatMap((filter) => filter.extensions)
    .map((extension) => extension.trim().replace(/^\./, ""))
    .filter(Boolean)
    .map((extension) => `.${extension}`)
    .join(",");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function selectBrowserOpenFiles(options: NativeOpenDialogOptions): Promise<ShellOpenSelection> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    const directoryInput = input as HTMLInputElement & { webkitdirectory?: boolean };
    input.type = "file";
    input.multiple = Boolean(options.multiple || options.directory);
    directoryInput.webkitdirectory = Boolean(options.directory);
    const accept = openDialogAccept(options.filters);
    if (accept) input.accept = accept;
    input.style.display = "none";

    const cleanup = () => input.remove();
    input.addEventListener(
      "change",
      () => {
        const selected = Array.from(input.files ?? []);
        void Promise.all(
          selected.map(async (file) => {
            const fileWithPath = file as File & { webkitRelativePath?: string };
            const dataBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
            return {
              name: file.name,
              relativePath: fileWithPath.webkitRelativePath || undefined,
              dataBase64,
            };
          }),
        )
          .then((files) => resolve({ paths: [], files }))
          .catch(reject)
          .finally(cleanup);
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        cleanup();
        resolve({ paths: [], files: [] });
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

export const browserShellHost: ShellHost = {
  kind: "browser",
  capabilities: {
    nativeMenu: false,
    nativeFileDialogs: false,
    nativeWindowChrome: false,
    chartPickerWindow: false,
    crossWindowCommandAckOptional: false,
  },
  closeChartPickerWindow: async () => {
    throw new Error("native chart picker window is unavailable in browser runtime");
  },
  confirmQuit: async () => {},
  copyImage: copyImageInBrowser,
  downloadBytes: async (filename: string, bytes: Uint8Array, mimeType: string) => {
    downloadBytesInBrowser(filename, bytes, mimeType);
  },
  installBeforeUnloadGuard: (shouldBlock: () => boolean) => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlock()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  },
  listenChartPickerWindowEvents: async () => () => {},
  listenMenuCommands: async () => () => {},
  listenQuitRequested: async () => () => {},
  openChartPickerWindow: async () => {
    throw new Error("native chart picker window is unavailable in browser runtime");
  },
  openChartPickerWindowFallback: async () => {
    throw new Error("native chart picker window is unavailable in browser runtime");
  },
  openExternal: async (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  requestDaemon: async () => null,
  prewarmNativeApi: async () => {},
  prewarmChartPickerWindow: async () => {},
  recordFrontendPerf: async () => {},
  restoreCurrentChartPickerWindow: async () => {},
  closeCurrentChartPickerWindow: async () => {
    window.close();
  },
  selectOpenFiles: selectBrowserOpenFiles,
  selectOpenPaths: async () => {
    throw new Error("native open dialog is unavailable in browser runtime");
  },
  selectSavePath: async () => {
    throw new Error("native save dialog is unavailable in browser runtime");
  },
  setWindowTitle: async () => {},
  syncMenuChecked: async (states: ShellMenuCheckedState[]) => {
    mirrorShellMenuChecked(states);
  },
  syncMenuEnablement: async (states: ShellMenuEnabledState[]) => {
    mirrorShellMenuEnablement(states);
  },
  syncMenuLabels: async () => {},
  syncRecentCharts: async () => {},
};

export const tauriShellHost: ShellHost = {
  kind: "tauri",
  capabilities: {
    nativeMenu: true,
    nativeFileDialogs: true,
    nativeWindowChrome: true,
    chartPickerWindow: true,
    crossWindowCommandAckOptional: true,
  },
  closeChartPickerWindow: async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("close_chart_picker_window");
  },
  confirmQuit: async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("confirm_quit");
  },
  copyImage: async (bytes: Uint8Array) => {
    const { Image } = await import("@tauri-apps/api/image");
    const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const image = await Image.fromBytes(bytes);
    try {
      await writeImage(image);
    } finally {
      await image.close();
    }
  },
  downloadBytes: async (filename: string, bytes: Uint8Array, mimeType: string) => {
    downloadBytesInBrowser(filename, bytes, mimeType);
  },
  installBeforeUnloadGuard: () => () => {},
  listenChartPickerWindowEvents: async (onEvent: (payload: Record<string, unknown>) => void) => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<Record<string, unknown>>("aries://chart-picker-window", (event) => {
      onEvent(event.payload ?? {});
    });
  },
  listenMenuCommands: async (onCommand: (command: string) => void) => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("aries://menu-command", (event) => {
      if (event.payload) {
        onCommand(event.payload);
      }
    });
  },
  listenQuitRequested: async (onRequest: () => void) => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("aries://quit-requested", () => {
      onRequest();
    });
  },
  openChartPickerWindow: async (options: NativeChartPickerWindowOptions) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_chart_picker_window", options);
  },
  openChartPickerWindowFallback: async ({
    path,
    title,
  }: NativeChartPickerWindowOptions) => {
    const label = "chart-picker";
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const picker = new WebviewWindow(label, {
      url: path,
      title,
      width: 760,
      height: 660,
      minWidth: 640,
      minHeight: 480,
      resizable: true,
      decorations: true,
      center: true,
    });

    await new Promise<void>((resolve, reject) => {
      const cleanup: Array<() => void> = [];
      const done = () => {
        cleanup.forEach((stop) => stop());
        resolve();
      };
      const fail = (error: unknown) => {
        cleanup.forEach((stop) => stop());
        reject(error);
      };
      picker.once("tauri://created", done).then((stop) => cleanup.push(stop));
      picker.once("tauri://error", (event) => fail(event.payload)).then((stop) => cleanup.push(stop));
    });
    await picker.show();
    await picker.setFocus();
  },
  openExternal: async (url: string) => {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  },
  requestDaemon: async (method: "GET" | "POST", path: string, body?: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<NativeDaemonResponse>("native_daemon_request", {
      request: { method, path, body },
    });
  },
  prewarmNativeApi: async () => {
    await import("@tauri-apps/api/core");
  },
  prewarmChartPickerWindow: async (options: NativeChartPickerWindowOptions) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("prewarm_chart_picker_window", options);
  },
  recordFrontendPerf: async (event: FrontendPerfEvent) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("record_frontend_perf", { event });
  },
  restoreCurrentChartPickerWindow: async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const current = getCurrentWindow();
    if (current.label !== "chart-picker") return;
    await current.show();
    await current.setFocus();
  },
  closeCurrentChartPickerWindow: async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const current = getCurrentWindow();
    if (current.label === "chart-picker") {
      await current.close();
      return;
    }
    window.location.assign("/");
  },
  selectOpenPaths: async (options: NativeOpenDialogOptions) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open(options);
    if (!selected) return [];
    return Array.isArray(selected) ? selected.map(String) : [String(selected)];
  },
  selectOpenFiles: async (options: NativeOpenDialogOptions) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open(options);
    if (!selected) return { paths: [], files: [] };
    const paths = Array.isArray(selected) ? selected.map(String) : [String(selected)];
    return { paths, files: [] };
  },
  selectSavePath: async (options: NativeSaveDialogOptions) => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const selected = await save(options);
    return selected ? String(selected) : null;
  },
  setWindowTitle: async (title: string, shouldApply?: () => boolean) => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (shouldApply && !shouldApply()) return;
    await getCurrentWindow().setTitle(title);
  },
  syncMenuChecked: async (states: ShellMenuCheckedState[]) => {
    mirrorShellMenuChecked(states);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_native_menu_checked", { states });
  },
  syncMenuEnablement: async (states: ShellMenuEnabledState[]) => {
    mirrorShellMenuEnablement(states);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_native_menu_enabled", { states });
  },
  syncMenuLabels: async (labels: ShellMenuLabelState[]) => {
    if (labels.length === 0) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_native_menu_labels", { labels });
  },
  syncRecentCharts: async (entries: ShellRecentChartEntry[]) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_recent_charts", { entries });
  },
};

export function resolveShellHost(): ShellHost {
  return hasTauriInternals() ? tauriShellHost : browserShellHost;
}

export async function confirmQuit(): Promise<void> {
  try {
    await resolveShellHost().confirmQuit();
  } catch {
    // Non-native hosts do not need a shell quit acknowledgement.
  }
}
