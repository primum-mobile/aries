// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Cross-surface wiring for open Astrolabes:
//  * titleSuffix — the live "real date · Age: N" titlebar suffix. The daemon
//    builds both strings with every rete geometry; the view publishes them so
//    the shared titlebar follows the arc while it is dragged.
//  * arcRequest — a primary-direction row asking an Astrolabe to turn its rete
//    to the row's arc. The view applies it and persists the arc in the daemon.

import { create } from "zustand";

export type AstrolabeArcRequest = { documentId: string; arc: number; seq: number; persisted?: boolean };

type AstrolabeState = {
  titleSuffix: Record<string, string>;
  setTitleSuffix: (documentId: string, suffix: string | null) => void;
  arcRequest: AstrolabeArcRequest | null;
  requestArc: (documentId: string, arc: number, persisted?: boolean) => void;
};

export const useAstrolabeStore = create<AstrolabeState>((set) => ({
  titleSuffix: {},
  setTitleSuffix: (documentId, suffix) =>
    set((state) => {
      if ((state.titleSuffix[documentId] ?? null) === suffix) return state;
      const next = { ...state.titleSuffix };
      if (suffix) next[documentId] = suffix;
      else delete next[documentId];
      return { titleSuffix: next };
    }),
  arcRequest: null,
  requestArc: (documentId, arc, persisted = false) =>
    set((state) => ({
      arcRequest: { documentId, arc, persisted, seq: (state.arcRequest?.seq ?? 0) + 1 },
    })),
}));
