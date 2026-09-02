// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkspaceDocument } from "@/stores/workspace-store";

function isChartDocument(document: WorkspaceDocument): boolean {
  return document.kind === "radix" ||
    document.kind === "here-now" ||
    document.kind === "supplementary";
}

export function documentPairSupportsDirectAttach(
  source: WorkspaceDocument | null | undefined,
  target: WorkspaceDocument | null | undefined,
): boolean {
  if (!source || !target) return false;
  if (source.parentDocumentId !== target.parentDocumentId) return true;
  return source.parentDocumentId === null &&
    isChartDocument(source) &&
    isChartDocument(target);
}
