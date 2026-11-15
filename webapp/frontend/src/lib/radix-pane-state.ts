// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

type DocumentLink = { documentId: string; parentDocumentId: string | null };
type Pane = object | null;

export function hasRadixPane(panes: Record<string, Pane>): boolean {
  return Object.values(panes).some((pane) => pane !== null);
}

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

/** Drop a pane whose owner left the daemon tree; re-aim a stale cursor.
 *
 * Lists opened from a child chart remember that child as their cursor
 * document. When only the child closes, the list stays on its live owner and
 * the cursor falls back to it, so daemon actions never post a dead id. */
export function livePane<T extends Pane>(pane: T, ids: ReadonlySet<string>): T | null {
  if (!pane || !("documentId" in pane) || typeof pane.documentId !== "string") return pane;
  if (!ids.has(pane.documentId)) return null;
  const cursor = "cursorDocumentId" in pane ? pane.cursorDocumentId : undefined;
  const policy = "followPolicy" in pane ? pane.followPolicy as { cursorDocumentId?: unknown } | null | undefined : undefined;
  const policyCursor = policy?.cursorDocumentId;
  const staleCursor = typeof cursor === "string" && !ids.has(cursor);
  const stalePolicy = typeof policyCursor === "string" && !ids.has(policyCursor);
  if (!staleCursor && !stalePolicy) return pane;
  return {
    ...pane,
    ...(staleCursor ? { cursorDocumentId: pane.documentId } : {}),
    ...(stalePolicy ? { followPolicy: { ...policy, cursorDocumentId: pane.documentId } } : {}),
  };
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
      const next = livePane(pane, ids);
      if (next !== pane) {
        if (result === value) result = { ...value };
        result[key as keyof P] = next as P[keyof P];
      }
    }
    return result;
  };
  const next = { ...retained };
  // Hiding the current pane does not erase a radix's last content, which can
  // be restored by an explicit reopen or when returning to its chart tab.
  if (owner && ids.has(owner) && hasRadixPane(panes)) next[owner] = clean(panes);
  for (const id of Object.keys(next)) {
    if (!ids.has(id)) delete next[id];
    else next[id] = clean(next[id]);
  }
  return {
    panes: owner === nextOwner ? clean(panes) : (nextOwner && next[nextOwner]) || empty,
    retained: next,
  };
}
