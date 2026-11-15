// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

import type { LicenseStatus } from "@/lib/licensing/client";

type LicenseStateStore = {
  status: LicenseStatus | null;
  /** Native error code from the automatic startup renewal, if it failed. */
  startupError: string | null;
  setStatus: (status: LicenseStatus) => void;
  setStartupError: (code: string | null) => void;
};

export const useLicenseStateStore = create<LicenseStateStore>((set) => ({
  status: null,
  startupError: null,
  setStatus: (status) => set({ status }),
  setStartupError: (startupError) => set({ startupError }),
}));
