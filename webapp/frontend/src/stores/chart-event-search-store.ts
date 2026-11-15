// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import {
  fetchChartEventSearchCatalog, searchChartEvents,
  type ChartEventSearchPayload, type ChartPickerAspectClause,
  type ChartPickerPlacementClause, type ChartPickerSearchCatalog,
} from "@/lib/daemon/client";
import type { SavedChartEvent } from "./chart-events-store";

export type EventSearchInput = Omit<ChartEventSearchPayload, "documentId" | "offset" | "limit">;
type EventSearchView = {
  open: boolean;
  active: boolean;
  placements: ChartPickerPlacementClause[];
  aspects: ChartPickerAspectClause[];
  includeAsteroids: boolean;
  stationWindowDays: string;
  catalog: ChartPickerSearchCatalog | null;
  catalogLoading: boolean;
  rows: SavedChartEvent[];
  ready: boolean;
  loading: boolean;
  done: boolean;
  offset: number;
  total: number;
  errors: number;
  error: boolean;
  requestedKey: string;
  input: EventSearchInput | null;
};

const emptyPlacement = (): ChartPickerPlacementClause => ({
  objectIds: [], signIndices: [], degree: "", degreeOrb: "1", houseNumbers: [], motion: "",
});
const emptyAspect = (): ChartPickerAspectClause => ({
  objectAIds: [], aspectType: "-1", objectBIds: [], orb: "1",
});
export const EMPTY_EVENT_SEARCH: EventSearchView = {
  open: false, active: false, placements: [emptyPlacement()], aspects: [emptyAspect()],
  includeAsteroids: false, stationWindowDays: "2", catalog: null, catalogLoading: false,
  rows: [], ready: false, loading: false, done: true, offset: 0, total: 0,
  errors: 0, error: false, requestedKey: "", input: null,
};

export function activeEventPlacements(rows: ChartPickerPlacementClause[]): ChartPickerPlacementClause[] {
  return rows.filter((row) => row.objectIds.length || row.signIndices.length || row.degree.trim()
    || row.houseNumbers.length || row.motion || row.motions?.length);
}
export function activeEventAspects(rows: ChartPickerAspectClause[]): ChartPickerAspectClause[] {
  return rows.filter((row) => row.aspectTypes?.length || (row.aspectType && row.aspectType !== "-1"));
}

const requests = new Map<string, AbortController>();
const catalogRequests = new Map<string, AbortController>();

export const useChartEventSearchStore = create<{
  views: Record<string, EventSearchView>;
  patch: (id: string, patch: Partial<EventSearchView>) => void;
  loadCatalog: (id: string, refresh?: boolean) => Promise<void>;
  start: (id: string, key: string, input: EventSearchInput) => Promise<void>;
  next: (id: string) => Promise<void>;
  pause: (id: string) => void;
  stop: (id: string) => void;
}>((set, get) => ({
  views: {},
  patch: (id, patch) => set((state) => {
    const views = { ...state.views, [id]: { ...(state.views[id] ?? EMPTY_EVENT_SEARCH), ...patch } };
    for (const key of Object.keys(views).filter((key) => key !== id).slice(0, Math.max(0, Object.keys(views).length - 32))) {
      requests.get(key)?.abort();
      catalogRequests.get(key)?.abort();
      requests.delete(key);
      catalogRequests.delete(key);
      delete views[key];
    }
    return { views };
  }),
  loadCatalog: async (id, refresh = false) => {
    const view = get().views[id] ?? EMPTY_EVENT_SEARCH;
    if (view.catalogLoading || (view.catalog && !refresh)) return;
    const controller = new AbortController();
    catalogRequests.get(id)?.abort();
    catalogRequests.set(id, controller);
    get().patch(id, { catalogLoading: true });
    try {
      const catalog = await fetchChartEventSearchCatalog(id, controller.signal);
      if (catalogRequests.get(id) === controller) get().patch(id, { catalog, catalogLoading: false });
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("[chart-event-search-catalog]", error);
        get().patch(id, { catalogLoading: false, error: true });
      }
    } finally {
      if (catalogRequests.get(id) === controller) catalogRequests.delete(id);
    }
  },
  start: async (id, key, input) => {
    const view = get().views[id] ?? EMPTY_EVENT_SEARCH;
    if (view.active && view.requestedKey === key && (view.loading || view.done)) return;
    if (view.active && view.requestedKey === key && view.ready) return get().next(id);
    requests.get(id)?.abort();
    requests.delete(id);
    get().patch(id, { active: true, requestedKey: key, input, offset: 0,
      loading: false, done: false, errors: 0, error: false });
    return get().next(id);
  },
  next: async (id) => {
    const view = get().views[id] ?? EMPTY_EVENT_SEARCH;
    if (!view.active || !view.input || view.loading || view.done) return;
    const controller = new AbortController();
    requests.set(id, controller);
    get().patch(id, { loading: true, error: false });
    try {
      const page = await searchChartEvents({ ...view.input, documentId: id, offset: view.offset, limit: 8 }, controller.signal);
      if (requests.get(id) !== controller || get().views[id]?.requestedKey !== view.requestedKey) return;
      get().patch(id, { rows: view.offset === 0 ? page.rows : [...view.rows, ...page.rows],
        ready: true, loading: false, done: page.done, offset: page.nextOffset,
        total: page.totalCandidates, errors: view.errors + page.errors });
    } catch (error) {
      if (requests.get(id) !== controller || controller.signal.aborted) return;
      console.error("[chart-event-search]", error);
      get().patch(id, { loading: false, error: true });
    } finally {
      if (requests.get(id) === controller) requests.delete(id);
    }
  },
  pause: (id) => {
    requests.get(id)?.abort();
    requests.delete(id);
    get().patch(id, { loading: false });
  },
  stop: (id) => {
    requests.get(id)?.abort();
    requests.delete(id);
    get().patch(id, { active: false, loading: false });
  },
}));
