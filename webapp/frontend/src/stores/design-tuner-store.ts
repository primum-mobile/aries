// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// In-frame design tuners: temporary development slider panels that write a
// surface's style tokens live for quick design changes. Shift+Cmd+D toggles
// them app-wide. Beta releases never include them; `make app` and
// `make tester` opt in with NEXT_PUBLIC_ARIES_DESIGN_TUNERS=1.

import { create } from "zustand";

function personalBuildOptIn() {
  try {
    return process.env.NEXT_PUBLIC_ARIES_DESIGN_TUNERS === "1";
  } catch {
    // Test and mockup bundles define only the variables they use and have no `process`.
    return false;
  }
}

export const DESIGN_TUNERS_ENABLED = process.env.NODE_ENV !== "production" || personalBuildOptIn();

type DesignTunerState = {
  open: boolean;
  toggle: () => void;
};

export const useDesignTunerStore = create<DesignTunerState>((set) => ({
  open: false,
  toggle: () => set((state) => ({ open: !state.open })),
}));
