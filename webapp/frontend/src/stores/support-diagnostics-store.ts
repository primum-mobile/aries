// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

import type { DaemonStartupFailure } from "@/lib/shell/support-diagnostics";

// Presentation state of the Windows support dialogs: the Help > Diagnostics
// dialog and the engine start-up failure reported by the native shell.
type SupportDiagnosticsStore = {
  diagnosticsOpen: boolean;
  setDiagnosticsOpen: (open: boolean) => void;
  startupFailure: DaemonStartupFailure | null;
  startupFailureDismissed: boolean;
  setStartupFailure: (failure: DaemonStartupFailure | null) => void;
  dismissStartupFailure: () => void;
};

export const useSupportDiagnosticsStore = create<SupportDiagnosticsStore>((set) => ({
  diagnosticsOpen: false,
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),
  startupFailure: null,
  startupFailureDismissed: false,
  setStartupFailure: (startupFailure) => set({ startupFailure, startupFailureDismissed: false }),
  dismissStartupFailure: () => set({ startupFailureDismissed: true }),
}));
