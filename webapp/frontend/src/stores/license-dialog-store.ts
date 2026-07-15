// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

type LicenseDialogStore = {
  open: boolean;
  openDialog: () => void;
  setOpen: (open: boolean) => void;
};

export const useLicenseDialogStore = create<LicenseDialogStore>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  setOpen: (open) => set({ open }),
}));
