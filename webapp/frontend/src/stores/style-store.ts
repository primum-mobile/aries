// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

import {
  type StyleTokenId,
  type StyleTokenValue,
  type StyleTokenValues,
} from "@/styles/style-tokens";

type StyleState = {
  values: StyleTokenValues;
  setToken: (id: StyleTokenId, value: StyleTokenValue) => void;
  resetToken: (id: StyleTokenId) => void;
  resetAll: () => void;
};

/**
 * Transient design-preview values only. Durable style preferences belong to
 * the daemon options/profile contract, alongside every other app setting.
 */
export const useStyleStore = create<StyleState>()((set) => ({
  values: {},
  setToken: (id, value) =>
    set((state) => ({
      values: { ...state.values, [id]: value },
    })),
  resetToken: (id) =>
    set((state) => {
      const next = { ...state.values };
      delete next[id];
      return { values: next };
    }),
  resetAll: () => set({ values: {} }),
}));
