// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { URANIA_STEPS } from "@/lib/urania-tour";

export const URANIA_SEEN_KEY = "aries.urania.seen.v1";
type TourStorage = Pick<Storage, "getItem" | "setItem">;
type UraniaTourState = {
  step: number | null;
  offered: boolean;
  focusRequested: boolean;
  offer: (prepare?: () => Promise<unknown>) => Promise<void>;
  start: (focusControls?: boolean) => void;
  focusHandled: () => void;
  back: () => void;
  next: () => void;
  /** Jump to a chapter from the progress dots; only while the tour is open. */
  go: (step: number) => void;
  dismiss: () => void;
};

function browserStorage(): TourStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

/** UI onboarding only: never stores or changes astrology/session state. */
export function createUraniaTourStore(storage: () => TourStorage | null = browserStorage) {
  return create<UraniaTourState>((set, get) => ({
    step: null,
    offered: false,
    focusRequested: false,
    offer: async (prepare) => {
      if (get().offered) return;
      let seen = false;
      try { seen = storage()?.getItem(URANIA_SEEN_KEY) === "1"; } catch { /* Storage may be unavailable. */ }
      set({ offered: true });
      if (seen) return;
      const pending = get();
      try {
        if (prepare) await prepare();
      } finally {
        // A manual replay or dismissal can take over while the chart opens.
        if (get() === pending) set({ step: 0 });
      }
    },
    start: (focusControls = false) => set({ offered: true, step: 0, focusRequested: focusControls }),
    focusHandled: () => set({ focusRequested: false }),
    back: () => set((state) => ({ step: state.step === null ? null : Math.max(0, state.step - 1) })),
    go: (step) => set((state) => ({
      step: state.step === null ? null : Math.min(URANIA_STEPS.length - 1, Math.max(0, Math.trunc(step))),
    })),
    next: () => {
      const step = get().step;
      if (step === null) return;
      if (step === URANIA_STEPS.length - 1) get().dismiss();
      else set({ step: step + 1 });
    },
    dismiss: () => {
      try { storage()?.setItem(URANIA_SEEN_KEY, "1"); } catch { /* Still dismiss for this session. */ }
      set({ offered: true, step: null, focusRequested: false });
    },
  }));
}

export const useUraniaTourStore = createUraniaTourStore();
