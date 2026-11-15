// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/** One owner for a retained list's replacement and adjacent/streaming loads.
 * Rows stay visible on replacement, but cease to be request authority until
 * the new payload is accepted. Publication is synchronous, before React paints.
 * A ticket remains current after finish (for retry timers), until superseded.
 * Subscribers hear every busy/idle change: an aborted extension whose list is
 * republished unchanged must still let the list resume growing.
 */
export type RetainedListRequest<T> = {
  signal: AbortSignal;
  current: () => boolean;
  publish: (value: T) => boolean;
  finish: () => boolean;
  cancel: () => void;
};

export function createRetainedListRequests<T>(initial: T | null = null) {
  const store = { current: initial };
  let generation: AbortController | null = null;
  let replacement: AbortController | null = null;
  let extension: AbortController | null = null;
  let loading = false;
  let extending = false;
  let ready = false;
  const listeners = new Set<() => void>();
  let wasBusy = true;
  const changed = () => {
    const busy = loading || extending || !ready;
    if (busy === wasBusy) return;
    wasBusy = busy;
    for (const listener of listeners) listener();
  };

  const cancel = () => {
    generation?.abort();
    extension?.abort();
    generation = replacement = extension = null;
    loading = extending = ready = false;
    changed();
  };
  function ticket(controller: AbortController, initial: boolean): RetainedListRequest<T> {
    const owner = generation;
    const current = () => generation === owner && !controller.signal.aborted
      && (initial ? replacement : extension) === controller;
    return {
      signal: controller.signal,
      current,
      publish(value) {
        if (!current()) return false;
        store.current = value;
        ready = true;
        changed();
        return true;
      },
      finish() {
        if (!current() || !(initial ? loading : extending)) return false;
        if (initial) loading = false;
        else extending = false;
        changed();
        return true;
      },
      cancel() {
        if (!current()) return;
        if (initial) cancel();
        else {
          controller.abort();
          extension = null;
          extending = false;
          changed();
        }
      },
    };
  }
  return {
    /** Last accepted payload: request authority for adjacent loads. */
    accepted: () => store.current,
    get loading() { return loading; },
    get extending() { return extending; },
    get busy() { return loading || extending || !ready; },
    /** For useSyncExternalStore: notifies when the list turns busy or idle. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    replace(): RetainedListRequest<T> {
      cancel();
      generation = replacement = new AbortController();
      loading = true;
      changed();
      return ticket(replacement, true);
    },
    extend(): RetainedListRequest<T> | null {
      if (!ready || loading || extending || !store.current) return null;
      extension?.abort();
      extension = new AbortController();
      extending = true;
      changed();
      return ticket(extension, false);
    },
    cancel,
    /** A new owner (document/table): drop all work and reseed accepted data. */
    reset(value: T | null) {
      cancel();
      store.current = value;
    },
  };
}
