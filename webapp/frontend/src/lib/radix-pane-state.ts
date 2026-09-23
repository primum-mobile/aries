// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

type DocumentLink = { documentId: string; parentDocumentId: string | null };
type Pane = object | null;

/** Resolve presentation ownership from the canonical daemon tree, never names. */
export function radixPaneOwner(documents: readonly DocumentLink[], documentId: string | null): string | null {
  const byId = new Map(documents.map((doc) => [doc.documentId, doc]));
  const visited = new Set<string>();
  let doc = documentId ? byId.get(documentId) : undefined;
  while (doc) {
    if (visited.has(doc.documentId)) return null;
    visited.add(doc.documentId);
    if (!doc.parentDocumentId) return doc.documentId;
    doc = byId.get(doc.parentDocumentId);
  }
  return null;
}

export function retainRadixPanes<P extends Record<string, Pane>>(
  documents: readonly DocumentLink[],
  owner: string | null,
  nextOwner: string | null,
  panes: P,
  retained: Record<string, P>,
  empty: P,
): { panes: P; retained: Record<string, P> } {
  const ids = new Set(documents.map((doc) => doc.documentId));
  const clean = (value: P): P => {
    let result = value;
    for (const key of Object.keys(value)) {
      const pane = value[key];
      if (pane && "documentId" in pane && typeof pane.documentId === "string" && !ids.has(pane.documentId)) {
        if (result === value) result = { ...value };
        result[key as keyof P] = null as P[keyof P];
      }
    }
    return result;
  };
  const next = { ...retained };
  if (owner && ids.has(owner)) next[owner] = clean(panes);
  for (const id of Object.keys(next)) {
    if (!ids.has(id)) delete next[id];
    else next[id] = clean(next[id]);
  }
  return {
    panes: owner === nextOwner ? clean(panes) : (nextOwner && next[nextOwner]) || empty,
    retained: next,
  };
}
