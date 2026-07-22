// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { create } from "zustand";

import { isAbortError, isTransientDaemonFetchError } from "@/lib/abort-error";
import { fetchThemeState as fetchDaemonThemeState, type ThemeState } from "@/lib/daemon/client";
import { THEME_STATE_STORAGE_KEY } from "@/lib/theme/constants";
import { normalizeThemeState } from "@/lib/theme/style-state.mjs";

type ThemeStatus = "idle" | "loading" | "ready" | "error";

type ThemeStore = {
  theme: ThemeState | null;
  status: ThemeStatus;
  error: string | null;
  applyThemeState: (theme: ThemeState) => void;
  fetchThemeState: (signal?: AbortSignal) => Promise<ThemeState | null>;
};

export function readStoredThemeState(): ThemeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return normalizeThemeState(parsed);
  } catch {
    return null;
  }
}

function writeCachedThemeState(theme: ThemeState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STATE_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Theme cache is a paint optimization; daemon state remains authoritative.
  }
}

const cachedTheme = readStoredThemeState();

export const useThemeStore = create<ThemeStore>()((set, get) => ({
  theme: cachedTheme,
  status: cachedTheme ? "ready" : "idle",
  error: null,

  applyThemeState: (theme) => {
    const normalized = normalizeThemeState(theme);
    if (!normalized) return;
    const current = get().theme;
    if (
      current?.schemaVersion === normalized.schemaVersion &&
      current.styleRevision === normalized.styleRevision &&
      current.styleHash === normalized.styleHash &&
      current.presentationCursor === normalized.presentationCursor
    ) {
      return;
    }
    writeCachedThemeState(normalized);
    set({ theme: normalized, status: "ready", error: null });
  },

  fetchThemeState: async (signal) => {
    if (!get().theme) {
      set({ status: "loading", error: null });
    }
    try {
      const next = await fetchDaemonThemeState(signal);
      if (signal?.aborted) return null;
      get().applyThemeState(next);
      return get().theme;
    } catch (err) {
      if (isAbortError(err, signal)) return null;
      if (isTransientDaemonFetchError(err)) {
        set({ status: get().theme ? "ready" : "idle", error: null });
        return null;
      }
      const message = String(err);
      set({ status: "error", error: message });
      console.error("[theme-state]", err);
      return null;
    }
  },
}));

export function syncThemeStateFromStorage(): ThemeState | null {
  const stored = readStoredThemeState();
  if (!stored) return null;
  useThemeStore.getState().applyThemeState(stored);
  return stored;
}

export function getCachedThemeState(): ThemeState | null {
  return useThemeStore.getState().theme ?? syncThemeStateFromStorage();
}

export function ensureThemeStateCached(signal?: AbortSignal): Promise<ThemeState | null> {
  const cached = getCachedThemeState();
  if (cached) return Promise.resolve(cached);
  return useThemeStore.getState().fetchThemeState(signal);
}
