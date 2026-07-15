// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

// Presentation-only open flag for the About dialog. Help is retained in the
// workspace right pane and therefore lives with the other workspace pane state.
type HelpAboutStore = {
  aboutOpen: boolean;
  openAbout: () => void;
  setAboutOpen: (open: boolean) => void;
};

export const useHelpAboutStore = create<HelpAboutStore>((set) => ({
  aboutOpen: false,
  openAbout: () => set({ aboutOpen: true }),
  setAboutOpen: (open) => set({ aboutOpen: open }),
}));
