// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";
import { persist } from "zustand/middleware";

type InspectorCardState = {
  collapsed: Record<string, true>;
  setOpen: (cardId: string, open: boolean) => void;
};

// Presentation preferences follow the source pack/rule, never the selected
// chart or passage. New cards remain expanded until the user collapses them.
export const useInspectorCardStore = create<InspectorCardState>()(
  persist(
    (set) => ({
      collapsed: {},
      setOpen: (cardId, open) => set((state) => {
        const collapsed = { ...state.collapsed };
        if (open) delete collapsed[cardId];
        else collapsed[cardId] = true;
        return { collapsed };
      }),
    }),
    {
      name: "aries-inspector-cards",
      partialize: (state) => ({ collapsed: state.collapsed }),
    },
  ),
);
