// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

export type BrowserChartPickerRequest = {
  mode: "open-radix" | "synastry-partner";
  title: string;
  parentRadixId?: string;
  excludeNames: string[];
  generation: number;
};

type BrowserChartPickerStore = {
  request: BrowserChartPickerRequest | null;
  openPicker: (request: Omit<BrowserChartPickerRequest, "generation">) => void;
  closePicker: () => void;
};

/** Browser hosts have no second native window: the picker floats in-page. */
export const useBrowserChartPickerStore = create<BrowserChartPickerStore>((set) => ({
  request: null,
  openPicker: (request) =>
    set((state) => ({ request: { ...request, generation: (state.request?.generation ?? 0) + 1 } })),
  closePicker: () => set({ request: null }),
}));
