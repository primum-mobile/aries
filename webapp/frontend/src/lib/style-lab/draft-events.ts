// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// The daemon announces every style-draft write on the workspace event socket.
// The open style editor listens here instead of polling the draft. A null
// change means "anything may have changed": the socket reconnected and events
// sent while it was down are lost, so the editor re-reads once.

export type StyleDraftChange = Readonly<{
  draftId: string | null;
  revision: number | null;
}>;

type StyleDraftListener = (change: StyleDraftChange | null) => void;

const listeners = new Set<StyleDraftListener>();

export function subscribeStyleDraftChanges(listener: StyleDraftListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishStyleDraftChange(change: StyleDraftChange | null): void {
  for (const listener of listeners) listener(change);
}
