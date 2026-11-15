// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorkspaceDocument } from "@/stores/workspace-store";
import { radixPaneOwner } from "@/lib/radix-pane-state";

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
  if (target.kind === "astrocart") {
    return source.kind === "supplementary" &&
      ["transits", "secondary", "minor", "tertiary", "solar_arc"].includes(
        source.supplementaryFeatureKind ?? "",
      );
  }
  if (source.parentDocumentId !== target.parentDocumentId) return true;
  return source.parentDocumentId === null &&
    isChartDocument(source) &&
    isChartDocument(target);
}

export function savedChartEventDropEligible(
  source: WorkspaceDocument | null | undefined,
  target: WorkspaceDocument | null | undefined,
): boolean {
  if (!source || !target || source.id === target.id) return false;
  if (target.parentDocumentId !== null || !["radix", "here-now"].includes(target.kind)) return false;
  return isChartDocument(source) || source.kind === "ascensional-transits";
}

/** Own child charts use the same recipe capture as the tab's Add event action. */
export function chartEventDropAction(
  source: WorkspaceDocument | null | undefined,
  target: WorkspaceDocument | null | undefined,
  documents: readonly WorkspaceDocument[],
): "workspace.save_event" | "workspace.copy_saved_chart_event" | null {
  if (savedChartEventDropEligible(source, target)) {
    if (source?.parentDocumentId) {
      const owner = radixPaneOwner(documents.map((doc) => ({
        documentId: doc.id, parentDocumentId: doc.parentDocumentId,
      })), source.id);
      if (!owner) return null;
      if (owner === target?.id) return "workspace.save_event";
    }
    return "workspace.copy_saved_chart_event";
  }
  return null;
}

export function dragPointInside(
  origin: { x: number; y: number } | null,
  delta: { x: number; y: number },
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom"> | null,
): boolean {
  if (!origin || !rect) return false;
  const x = origin.x + delta.x;
  const y = origin.y + delta.y;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
