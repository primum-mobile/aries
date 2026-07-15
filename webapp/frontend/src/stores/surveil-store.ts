// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

// Presentation-only state for the Surveil Studies management dialog. The dialog
// is retained app chrome opened from the chart context-menu "Surveil Studies..."
// item (surveil.open_studies). The brain (study store, marks) lives entirely in
// the daemon (surveil_service); this store holds ONLY the open flag.
type SurveilStore = {
  studiesDialogOpen: boolean;
  openStudiesDialog: () => void;
  setStudiesDialogOpen: (open: boolean) => void;
};

export const useSurveilStore = create<SurveilStore>((set) => ({
  studiesDialogOpen: false,
  openStudiesDialog: () => set({ studiesDialogOpen: true }),
  setStudiesDialogOpen: (open) => set({ studiesDialogOpen: open }),
}));
