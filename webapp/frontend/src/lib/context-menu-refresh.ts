// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Retain current menu rows until the newest request supplies a replacement. */
export function createContextMenuRefresh<T>(
  load: (signal?: AbortSignal) => Promise<T>,
  commit: (payload: T) => void,
) {
  let generation = 0;
  let disposed = false;
  return {
    cancel: () => { generation += 1; },
    activate: () => { disposed = false; },
    dispose: () => { disposed = true; generation += 1; },
    async refresh(signal?: AbortSignal): Promise<T> {
      if (disposed) throw new DOMException("Disposed menu context", "AbortError");
      const request = ++generation;
      try {
        const payload = await load(signal);
        if (request !== generation || signal?.aborted) {
          throw new DOMException("Superseded menu request", "AbortError");
        }
        commit(payload);
        return payload;
      } catch (error) {
        if (request !== generation || signal?.aborted) {
          throw new DOMException("Superseded menu request", "AbortError");
        }
        throw error;
      }
    },
  };
}
