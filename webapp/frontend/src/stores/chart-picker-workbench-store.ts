// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";
import { create } from "zustand";
import {
  fetchChartPickerWorkbench,
  patchChartPickerWorkbench,
  type ChartPickerWorkbenchState,
  type ChartPickerSearchRow,
  type ChartPickerSearchResult,
  type ChartPickerSearchCatalog,
} from "@/lib/daemon/client";

type SessionState = {
  catalog: ChartPickerSearchCatalog | null;
  rows: ChartPickerSearchRow[];
  selectedKey: string | null;
  summary: ChartPickerSearchResult["summary"] | null;
  searching: boolean;
  error: string | null;
  searchScrollTop: number;
  listScrollTop: number;
};

const defaults: ChartPickerWorkbenchState = {
  view: "list", filter: "", listSort: { column: "lastOpened", ascending: false },
  collectionPaths: null, collectionDrawerOpen: false,
  stationWindowDays: "2", includeAsteroids: false,
  placements: [{ objectIds: [], signIndices: [], degree: "", degreeOrb: "1", houseNumbers: [], motion: "" }],
  aspects: [{ objectAIds: [], aspectType: "-1", objectBIds: [], orb: "1" }],
  searchSort: null, placementDrawerOpen: true, aspectDrawerOpen: true,
};

let loading: Promise<void> | null = null;
let saving: Promise<void> | null = null;
let pending: Partial<ChartPickerWorkbenchState> = {};

export const useChartPickerWorkbenchStore = create<{
  preferences: ChartPickerWorkbenchState;
  session: SessionState;
  hydrated: boolean;
  persistenceError: boolean;
  load: () => Promise<void>;
  flush: () => Promise<void>;
  update: (patch: Partial<ChartPickerWorkbenchState>) => void;
}>((set, get) => ({
  preferences: defaults,
  session: { catalog: null, rows: [], selectedKey: null, summary: null, searching: false, error: null, searchScrollTop: 0, listScrollTop: 0 },
  hydrated: false,
  persistenceError: false,
  load: () => {
    if (get().hydrated) return Promise.resolve();
    if (loading) return loading;
    loading = fetchChartPickerWorkbench().then((saved) => {
      // A control edited while the initial request was in flight wins.
      set({ preferences: { ...defaults, ...saved, ...pending }, hydrated: true, persistenceError: false });
    }).catch((error) => {
      set({ persistenceError: true });
      throw error;
    }).finally(() => { loading = null; });
    return loading;
  },
  flush: () => {
    if (saving) return saving;
    saving = (async () => {
      await get().load();
      while (Object.keys(pending).length) {
        const patch = pending;
        pending = {};
        try {
          await patchChartPickerWorkbench(patch);
          set({ persistenceError: false });
        } catch (error) {
          pending = { ...patch, ...pending };
          set({ persistenceError: true });
          throw error;
        }
      }
    })().finally(() => {
      saving = null;
      if (!get().persistenceError && Object.keys(pending).length) void get().flush().catch(() => {});
    });
    return saving;
  },
  update: (patch) => {
    pending = { ...pending, ...patch };
    set({ preferences: { ...get().preferences, ...patch } });
    // Serialize saves so an older response cannot overwrite a newer toggle.
    void get().flush().catch(() => {});
  },
}));

export function usePickerPreference<K extends keyof ChartPickerWorkbenchState>(key: K) {
  const value = useChartPickerWorkbenchStore((state) => state.preferences[key]);
  const update = React.useCallback((next: React.SetStateAction<ChartPickerWorkbenchState[K]>) => {
    const store = useChartPickerWorkbenchStore.getState();
    const value = typeof next === "function" ? next(store.preferences[key]) : next;
    store.update({ [key]: value });
  }, [key]);
  return [value, update] as const;
}

export function usePickerSession<K extends keyof SessionState>(key: K) {
  const value = useChartPickerWorkbenchStore((state) => state.session[key]);
  const update = React.useCallback((next: React.SetStateAction<SessionState[K]>) => {
    useChartPickerWorkbenchStore.setState((state) => ({ session: {
      ...state.session, [key]: typeof next === "function" ? next(state.session[key]) : next,
    } }));
  }, [key]);
  return [value, update] as const;
}
