// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

import type { LicenseStatus } from "@/lib/licensing/client";

type LicenseStateStore = {
  status: LicenseStatus | null;
  setStatus: (status: LicenseStatus) => void;
};

export const useLicenseStateStore = create<LicenseStateStore>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));
