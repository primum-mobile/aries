// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export function isAbortError(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  // WebKit/Tauri reports aborted fetches as TypeError("Load failed") instead
  // of DOMException("AbortError"). Only treat that message as abort-like when
  // callers also pass an aborted signal.
  return signal?.aborted === true && error.name === "TypeError" && error.message === "Load failed";
}

export function isTransientDaemonFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name !== "TypeError") return false;
  return error.message === "Load failed" || error.message === "Failed to fetch";
}
