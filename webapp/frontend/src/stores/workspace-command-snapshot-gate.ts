// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

let pendingSnapshotCommands = 0;
const waiters = new Set<() => void>();

function notifyWaiters(): void {
  for (const waiter of Array.from(waiters)) {
    waiter();
  }
}

export function beginWorkspaceSnapshotCommand(): () => void {
  pendingSnapshotCommands += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pendingSnapshotCommands = Math.max(0, pendingSnapshotCommands - 1);
    if (pendingSnapshotCommands === 0) {
      notifyWaiters();
    }
  };
}

export function hasPendingWorkspaceSnapshotCommand(): boolean {
  return pendingSnapshotCommands > 0;
}

export function waitForWorkspaceSnapshotCommands(timeoutMs = 900): Promise<void> {
  if (pendingSnapshotCommands === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      waiters.delete(listener);
      resolve();
    };
    const listener = () => {
      if (pendingSnapshotCommands === 0) {
        finish();
      }
    };
    const timer = window.setTimeout(finish, timeoutMs);
    waiters.add(listener);
  });
}
