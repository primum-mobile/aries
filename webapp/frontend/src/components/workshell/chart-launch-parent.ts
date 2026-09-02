// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkspaceDocument } from "@/stores/workspace-store";

export function isChartLaunchParent(doc: WorkspaceDocument | null): boolean {
  return (
    doc?.kind === "radix" ||
    doc?.kind === "here-now" ||
    (
      doc?.kind === "supplementary" &&
      (doc.supplementaryFeatureKind !== undefined || doc.compoundKind === "composite_from_synastry")
    )
  );
}

export function findChartLaunchParent(
  documents: WorkspaceDocument[],
  id: string | null,
): WorkspaceDocument | null {
  if (!id) return null;
  let current = documents.find((doc) => doc.id === id) ?? null;
  while (current) {
    if (isChartLaunchParent(current)) return current;
    if (!current.parentDocumentId) return null;
    const parentId: string = current.parentDocumentId;
    current = documents.find((doc) => doc.id === parentId) ?? null;
  }
  return null;
}

/** Resolve launchers whose results always belong beside the branch radix. */
export function findRadixSiblingLaunchParent(
  documents: WorkspaceDocument[],
  id: string | null,
): WorkspaceDocument | null {
  const launchParent = findChartLaunchParent(documents, id);
  if (!launchParent || launchParent.compoundKind === "composite_from_synastry") {
    return launchParent;
  }
  let current: WorkspaceDocument | null = launchParent;
  while (current) {
    if (current.kind === "radix") return current;
    if (!current.parentDocumentId) break;
    const parentId: string = current.parentDocumentId;
    current = documents.find((doc) => doc.id === parentId) ?? null;
  }
  return launchParent;
}
