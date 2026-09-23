// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

let pendingSnapshotCommands = 0;
const waiters = new Set<() => void>();
const documentCommandGenerations = new Map<string, number>();
const documentCommandTails = new Map<string, Promise<void>>();

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

export type WorkspaceDocumentSnapshotCommandResult<T> = {
  result: T;
  isLatest: boolean;
};

/**
 * Serialize snapshot-producing mutations for one document and mark their
 * intent before any transport starts. Harmonic projection mode/number changes
 * use this boundary so a stale menu response cannot overtake a newer choice,
 * and chart stepping can wait for the canonical projection before deriving the
 * next frame.
 */
export function runWorkspaceDocumentSnapshotCommand<T>(
  documentId: string,
  command: () => Promise<T>,
): Promise<WorkspaceDocumentSnapshotCommandResult<T>> {
  const generation = (documentCommandGenerations.get(documentId) ?? 0) + 1;
  documentCommandGenerations.set(documentId, generation);
  const finish = beginWorkspaceSnapshotCommand();
  const previous = documentCommandTails.get(documentId) ?? Promise.resolve();
  const execution = previous.catch(() => undefined).then(command);
  const tail = execution.then(
    () => undefined,
    () => undefined,
  );
  documentCommandTails.set(documentId, tail);
  void tail.finally(() => {
    if (documentCommandTails.get(documentId) === tail) {
      documentCommandTails.delete(documentId);
    }
  });
  return execution
    .then((result) => ({
      result,
      isLatest: documentCommandGenerations.get(documentId) === generation,
    }))
    .finally(finish);
}

export function workspaceDocumentSnapshotCommandGeneration(documentId: string): number {
  return documentCommandGenerations.get(documentId) ?? 0;
}

export function hasPendingWorkspaceDocumentSnapshotCommand(documentId: string): boolean {
  return documentCommandTails.has(documentId);
}

export function waitForWorkspaceDocumentSnapshotCommands(documentId: string): Promise<void> {
  return documentCommandTails.get(documentId) ?? Promise.resolve();
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
