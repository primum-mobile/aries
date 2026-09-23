// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { fetchNotes, saveNotes } from "@/lib/daemon/client";

export type EventNoteTarget = { recordId: string; eventId: string; name: string };
type Note = EventNoteTarget & {
  text: string; saved: string; revision?: string; loaded: boolean;
  loading: boolean; saving: boolean; error: string | null; edits: number;
};
export const EMPTY_EVENT_NOTE = { text: "", saved: "", loaded: false, loading: false,
  saving: false, error: null, edits: 0 };
export const eventNoteKey = (target: EventNoteTarget) => JSON.stringify([target.recordId, target.eventId]);
const reads = new Map<string, { promise: Promise<void>; signal?: AbortSignal }>();
const writes = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let reading = 0;
const waiting: (() => void)[] = [];
async function readSlot<T>(run: () => Promise<T>): Promise<T> {
  if (reading >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  else reading++;
  try { return await run(); }
  finally { const next = waiting.shift(); if (next) next(); else reading--; }
}

/** Shared-file drafts survive virtual row unmounts and keep their frozen IDs.
 * Only mounted rows request reads; writes are serialized per note, never per chart. */
export const useEventNotesStore = create<{
  notes: Record<string, Note>;
  patch: (key: string, patch: Partial<Note>) => void;
  load: (target: EventNoteTarget, signal?: AbortSignal, refresh?: boolean, replaceDraft?: boolean) => Promise<void>;
  edit: (target: EventNoteTarget, text: string) => void;
  flush: (key: string) => Promise<void>;
  flushAll: () => Promise<void>;
}>((set, get) => ({
  notes: {},
  patch: (key, patch) => set((state) => {
    const notes = { ...state.notes, [key]: { ...state.notes[key], ...patch } as Note };
    // Bound clean previews; never evict an unsaved or failed draft.
    for (const id of Object.keys(notes)) {
      if (Object.keys(notes).length <= 256) break;
      const note = notes[id];
      if (id !== key && note.loaded && !note.loading && !note.saving && !note.error && note.text === note.saved) delete notes[id];
    }
    return { notes };
  }),
  load: async (target, signal, refresh = false, replaceDraft = false) => {
    if (!target.recordId || signal?.aborted) return;
    const key = eventNoteKey(target);
    const current = get().notes[key];
    const active = reads.get(key);
    if (active) {
      await active.promise;
      if (active.signal?.aborted && !signal?.aborted) return get().load(target, signal, refresh, replaceDraft);
      return;
    }
    if (current && ((!replaceDraft && current.text !== current.saved) || current.saving || (current.loaded && !refresh))) return;
    const edits = current?.edits ?? 0;
    get().patch(key, { ...EMPTY_EVENT_NOTE, ...current, ...target, loading: true });
    const request = readSlot(async () => {
      if (signal?.aborted) return;
      try {
        const result = await fetchNotes(target.name, target, signal);
        const now = get().notes[key];
        if (signal?.aborted || now.edits !== edits || (!replaceDraft && now.text !== now.saved) || now.saving) return;
        get().patch(key, { text: result.content, saved: result.content, revision: result.revision, loaded: true, error: null });
      } catch {
        if (!signal?.aborted) get().patch(key, { error: "notes.statusError" });
      }
    }).finally(() => { reads.delete(key); get().patch(key, { loading: false }); });
    reads.set(key, { promise: request, signal });
    return request;
  },
  edit: (target, text) => {
    const key = eventNoteKey(target);
    const note = get().notes[key];
    if (!note?.loaded) return;
    get().patch(key, { ...target, text, edits: note.edits + 1, error: null });
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { void get().flush(key); }, 700));
  },
  flush: (key) => {
    clearTimeout(timers.get(key)); timers.delete(key);
    if (writes.has(key)) return writes.get(key)!;
    // Start on the next microtask so the queue owns even an immediate failure.
    const request = Promise.resolve().then(async () => {
      while (true) {
        const note = get().notes[key];
        if (!note?.loaded || note.text === note.saved) {
          clearTimeout(timers.get(key)); timers.delete(key); return;
        }
        get().patch(key, { saving: true });
        try {
          const result = await saveNotes(note.name, note.text, {
            recordId: note.recordId, eventId: note.eventId, revision: note.revision,
          });
          get().patch(key, { saved: note.text, revision: result.revision, error: null });
        } catch (error) {
          get().patch(key, { error: (error as Error).name === "NoteConflict" ? "notes.externalConflict" : "notes.statusError" });
          return;
        } finally { get().patch(key, { saving: false }); }
      }
    }).finally(() => { writes.delete(key); });
    writes.set(key, request);
    return request;
  },
  flushAll: async () => { await Promise.all(Object.keys(get().notes).map((key) => get().flush(key))); },
}));
