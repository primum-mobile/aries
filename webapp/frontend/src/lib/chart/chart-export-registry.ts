// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PdfChartColorMode } from "@/lib/daemon/client";

export type ChartExportRenderRequest = {
  kind: "pdf" | "png";
  colorMode: PdfChartColorMode;
  includeOverlays: boolean;
};

export type ChartExportRenderResult = {
  pngBase64: string;
  width: number;
  height: number;
};

export type ChartExportRenderer = (
  request: ChartExportRenderRequest,
) => Promise<ChartExportRenderResult>;

const renderers = new Map<string, ChartExportRenderer>();

export function registerChartExportRenderer(
  documentId: string,
  renderer: ChartExportRenderer,
): () => void {
  if (!documentId) return () => {};
  renderers.set(documentId, renderer);
  return () => {
    if (renderers.get(documentId) === renderer) renderers.delete(documentId);
  };
}

export async function renderRegisteredChartExport(
  documentId: string,
  request: ChartExportRenderRequest,
): Promise<ChartExportRenderResult> {
  const renderer = renderers.get(documentId);
  if (!renderer) {
    throw new Error(`visible chart renderer unavailable for ${documentId}`);
  }
  return renderer(request);
}
