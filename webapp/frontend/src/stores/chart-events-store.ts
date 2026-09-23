// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { executeWorkspaceContextMenuAction } from "@/lib/daemon/client";
import { perfNow, recordChartPerf } from "@/lib/chart/perf";

export type EventTag = { id: string; name: string; lastUsed?: number };

/** Current-chart usage, then recent assignments, then stable alphabetical order. */
export function rankedEventTags(catalog: EventTag[], counts: Record<string, number>): EventTag[] {
  return [...catalog].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)
    || (b.lastUsed ?? 0) - (a.lastUsed ?? 0)
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export type SavedChartEvent = {
  id: string;
  name: string;
  date: string;
  time: string;
  datetime: string;
  kind: string;
  tags?: EventTag[];
};
type EventPage = { recordId: string; rows: SavedChartEvent[]; total: number; sourceName: string;
  tagCatalog: EventTag[]; catalogVersion?: number; tagCounts: Record<string, number>; untaggedCount: number };
type EventView = EventPage & {
  query: string; scrollTop: number; loaded: boolean; stale: boolean;
  loading: boolean; error: string | null; revision: number;
  rowHeights: Record<string, number>; rowWidth: number;
  tagsOpen: boolean; tagQuery: string;
  tagIds: string[]; tagMatch: "any" | "all"; untagged: boolean;
};
export const EMPTY_EVENT_VIEW: EventView = {
  recordId: "", rows: [], total: 0, sourceName: "", query: "", scrollTop: 0,
  loaded: false, stale: true, loading: false, error: null, revision: 0,
  tagsOpen: false, tagQuery: "",
  tagCatalog: [], tagCounts: {}, untaggedCount: 0, tagIds: [], tagMatch: "any", untagged: false, rowHeights: {}, rowWidth: 0,
};

/** Display-only filters retain the paged source and never start another query. */
export function filteredChartEvents(view: Pick<EventView, "rows" | "query" | "untagged" | "tagIds" | "tagMatch">): SavedChartEvent[] {
  const query = view.query.trim().toLocaleLowerCase();
  return view.rows.filter((row) => {
    const tags = row.tags ?? [];
    if (query && ![row.name, ...tags.map((tag) => tag.name)].some((text) => text.toLocaleLowerCase().includes(query))) return false;
    if (view.untagged) return tags.length === 0;
    if (!view.tagIds.length) return true;
    const has = (id: string) => tags.some((tag) => tag.id === id);
    return view.tagMatch === "all" ? view.tagIds.every(has) : view.tagIds.some(has);
  });
}
const requests = new Map<string, AbortController>();

export const useChartEventsStore = create<{
  views: Record<string, EventView>;
  tagCatalog: EventTag[]; catalogVersion: number;
  applyTagCatalog: (tags: EventTag[], version?: number) => void;
  patch: (id: string, patch: Partial<EventView>) => void;
  invalidate: (ids: string[]) => void;
  load: (id: string, append?: boolean, ownerId?: string) => Promise<void>;
  setTags: (ownerId: string, eventId: string, tagIds: string[], name?: string) => Promise<void>;
  changeTag: (ownerId: string, tagId: string, name?: string) => Promise<void>;
}>((set, get) => ({
  views: {}, tagCatalog: [], catalogVersion: 0,
  applyTagCatalog: (tags, version = 0) => set((state) => {
    if (version < state.catalogVersion) return state;
    const catalog = version === state.catalogVersion
      ? [...new Map([...state.tagCatalog, ...tags].map((tag) => [tag.id, tag])).values()]
      : tags;
    if (version === state.catalogVersion && catalog.length === state.tagCatalog.length
      && catalog.every((tag, i) => tag.id === state.tagCatalog[i].id && tag.name === state.tagCatalog[i].name
        && tag.lastUsed === state.tagCatalog[i].lastUsed)) return state;
    const available = new Set(catalog.map((tag) => tag.id));
    const removed = new Set(state.tagCatalog.filter((tag) => !available.has(tag.id)).map((tag) => tag.id));
    return { tagCatalog: catalog, catalogVersion: version,
      views: Object.fromEntries(Object.entries(state.views).map(([id, view]) => [id, {
        ...view, tagCatalog: catalog, tagIds: view.tagIds.filter((tag) => !removed.has(tag)),
      }])) };
  }),
  patch: (id, patch) => set((state) => {
    const views = { ...state.views, [id]: { ...(state.views[id] ?? { ...EMPTY_EVENT_VIEW, tagCatalog: state.tagCatalog }), ...patch } };
    // Bound retained chrome across long sessions with many different radixes.
    for (const key of Object.keys(views).filter((key) => key !== id).slice(0, Math.max(0, Object.keys(views).length - 32))) {
      requests.get(key)?.abort();
      requests.delete(key);
      delete views[key];
    }
    return { views };
  }),
  invalidate: (ids) => {
    for (const id of ids.flatMap((ownerId) => [ownerId, `${ownerId}:events-menu`])) {
      requests.get(id)?.abort();
      requests.delete(id);
      const view = get().views[id];
      if (view) get().patch(id, { stale: true, loading: false, revision: view.revision + 1 });
    }
  },
  setTags: async (ownerId, eventId, tagIds, name) => {
    const result = await executeWorkspaceContextMenuAction("workspace.set_event_tags", {
      documentId: ownerId, eventId, tagIds, ...(name === undefined ? {} : { name }),
    }) as unknown as Pick<EventPage, "tagCatalog" | "catalogVersion" | "tagCounts" | "untaggedCount"> & { tags: EventTag[] };
    get().applyTagCatalog(result.tagCatalog, result.catalogVersion);
    for (const id of [ownerId, `${ownerId}:events-menu`]) {
      const view = get().views[id];
      if (!view) continue;
      get().patch(id, { tagCounts: result.tagCounts,
        untaggedCount: result.untaggedCount, error: null,
        rows: view.rows.map((row) => row.id === eventId ? { ...row, tags: result.tags } : row) });
    }
  },
  changeTag: async (ownerId, tagId, name) => {
    const result = await executeWorkspaceContextMenuAction(name === undefined ? "workspace.delete_event_tag" : "workspace.rename_event_tag", {
      documentId: ownerId, tagId, ...(name === undefined ? {} : { name }),
    }) as unknown as { tag: EventTag & { deleted?: boolean }; tagCatalog?: EventTag[]; catalogVersion?: number };
    const replace = (tags: EventTag[]) => tags.flatMap((tag) => tag.id !== tagId ? [tag] : result.tag.deleted ? [] : [result.tag]);
    if (result.tagCatalog) get().applyTagCatalog(result.tagCatalog, result.catalogVersion);
    for (const [id, view] of Object.entries(get().views)) {
      get().patch(id, { tagCatalog: replace(view.tagCatalog),
        tagIds: result.tag.deleted ? view.tagIds.filter((tag) => tag !== tagId) : view.tagIds,
        rows: view.rows.map((row) => ({ ...row, tags: replace(row.tags ?? []) })) });
    }
  },
  load: async (id, append = false, ownerId = id) => {
    const view = get().views[id] ?? EMPTY_EVENT_VIEW;
    if (view.loading || (!append && view.loaded && !view.stale && view.error !== "chartEvents.loadError")) return;
    if (append && view.rows.length >= view.total) return;
    const controller = new AbortController();
    requests.get(id)?.abort();
    requests.set(id, controller);
    get().patch(id, { loading: true, error: view.error === "chartEvents.loadError" ? null : view.error });
    const started = perfNow();
    try {
      const page = await executeWorkspaceContextMenuAction("workspace.list_events", {
        documentId: ownerId, query: "", offset: append ? view.rows.length : 0, limit: 128,
      }, controller.signal) as unknown as EventPage;
      if (requests.get(id) !== controller) return;
      if (page.tagCatalog) get().applyTagCatalog(page.tagCatalog, page.catalogVersion);
      get().patch(id, {
        ...page, tagCatalog: get().tagCatalog, rows: append ? [...view.rows, ...page.rows] : page.rows,
        loaded: true, stale: false, loading: false,
      });
      recordChartPerf("chart-events-page", {
        rowCount: page.rows.length, totalRows: page.total,
        apiMs: perfNow() - started,
      });
    } catch (error) {
      if (requests.get(id) !== controller || controller.signal.aborted) return;
      console.error("[chart-events-list]", error);
      get().patch(id, { loading: false, stale: false, error: "chartEvents.loadError" });
    } finally {
      if (requests.get(id) === controller) requests.delete(id);
    }
  },
}));
