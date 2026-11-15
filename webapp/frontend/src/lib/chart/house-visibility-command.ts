// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toggleHouses } from "@/lib/daemon/client";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import type { ChartRenderSnapshot } from "./types";

let commands: Promise<void> = Promise.resolve();

/** Present each input immediately; serialize daemon toggles so rapid presses
 * retain their parity. Older receipts cannot undo a newer pending preview. */
export function toggleRetainedHouseVisibility(snapshot: ChartRenderSnapshot): void {
  useDaemonWorkspaceStore.getState().previewHouseToggle(snapshot);
  commands = commands.then(async () => {
    try {
      const result = await toggleHouses();
      useDaemonWorkspaceStore.getState().finishHouseToggle(result);
    } catch (error) {
      useDaemonWorkspaceStore.getState().finishHouseToggle();
      console.error("[toggle-houses]", error);
    }
  });
}
