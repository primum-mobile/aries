// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartRenderSnapshot } from "@/lib/chart/types";

function harmonicProjectionIdentity(binding: unknown): [string, number | null] | null {
  if (!binding || typeof binding !== "object") return null;
  const retained = (binding as { retained_state?: unknown }).retained_state;
  if (!retained || typeof retained !== "object") return null;
  const state = retained as { projection_mode?: unknown; harmonic_number?: unknown; varga_number?: unknown };
  const mode = state.projection_mode === "varga" ? "varga" : "harmonic";
  const rawNumber = mode === "varga" ? state.varga_number : state.harmonic_number;
  const number = Number(rawNumber);
  return [mode, Number.isFinite(number) ? number : null];
}

/** Explicit chart sources remain selected across focus and wheel-mode changes. */
export function aspectListViewContext(chart: ChartRenderSnapshot | null, documentId: string) {
  if (!chart) return null;
  const split = chart.sideBySide;
  const selection = split?.aspectList;
  if (split?.enabled && selection &&
      [split.leftDocumentId, split.rightDocumentId].includes(documentId)) {
    const pair = [selection.primarySourceId, selection.outerSourceId].map(
      (id) => selection.sources.find((source) => source.id === id),
    );
    return {
      queryDocumentId: split.leftDocumentId ?? split.rightDocumentId ?? documentId,
      comparisonVisible: pair[1] != null,
      comparisonDocumentId: split.rightDocumentId,
      relatedDocumentIds: [...new Set(pair.flatMap((source) => source
        ? [source.documentId, source.ownerDocumentId].filter((id): id is string => Boolean(id))
        : []))],
      cursorIdentity: JSON.stringify(pair.map((source) => source?.cursorIdentity ?? null)),
      revision: JSON.stringify({
        sideBySideSources: [selection.primarySourceId, selection.outerSourceId],
        ascensional: selection.ascensional ?? false,
      }),
      selection,
    };
  }
  if (chart.document?.documentId !== documentId) return null;
  if (split?.enabled && split.leftDocumentId && split.rightDocumentId &&
      [split.leftDocumentId, split.rightDocumentId].includes(documentId)) {
    return {
      comparisonVisible: true,
      comparisonDocumentId: documentId === split.leftDocumentId ? split.rightDocumentId : split.leftDocumentId,
      revision: JSON.stringify({ sideBySide: [split.leftDocumentId, split.rightDocumentId] }),
    };
  }
  return {
    comparisonVisible: chart.comparisonChart != null,
    comparisonDocumentId: null,
    revision: JSON.stringify({
      viewMode: chart.document.viewMode,
      comparisonName: chart.document.comparisonName ?? null,
      compoundKind: chart.document.compoundKind ?? null,
      compositeVariant: chart.document.compositeVariant ?? null,
      showRadixComparison: chart.document.showRadixComparison ?? null,
      hasComparisonChart: chart.comparisonChart != null,
      // Ascensional rows are the wheel's own contacts.
      coordinateMode: chart.document.chartPresentation?.coordinateMode ?? "zodiacal",
      harmonicProjection: chart.document.featureKind === "harmonic"
        ? harmonicProjectionIdentity(chart.document.binding)
        : null,
    }),
  };
}
