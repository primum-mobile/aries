// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  PdfChartColorMode,
  PdfChartRasterPreset,
  PngChartAppearance,
} from "@/lib/daemon/client";
import { applyPdfRasterPreset } from "./pdf-raster-presets";

export type ChartExportRenderRequest = {
  kind: "pdf" | "png";
  output?: "base64" | "bytes";
  colorMode: PdfChartColorMode | PngChartAppearance;
  rasterPreset: PdfChartRasterPreset;
  includeOverlays: boolean;
  dignityHighlights: boolean;
  individualBodyColors: boolean;
};

export type ChartExportRenderResult = {
  pngBase64?: string;
  pngBytes?: Uint8Array;
  width: number;
  height: number;
};

export type ChartExportRenderer = (
  request: ChartExportRenderRequest,
) => Promise<ChartExportRenderResult>;

const renderers = new Map<string, ChartExportRenderer>();
const PNG_EXPORT_PIXEL_SIZE = 1200;

function cssBackgroundColor(element: HTMLElement): string {
  const elementColor = getComputedStyle(element).backgroundColor;
  if (elementColor && elementColor !== "rgba(0, 0, 0, 0)") return elementColor;
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--aries-background")
      .trim() || "transparent"
  );
}

function luminance(data: Uint8ClampedArray, index: number): number {
  return (
    (0.2126 * data[index]) +
    (0.7152 * data[index + 1]) +
    (0.0722 * data[index + 2])
  );
}

function hasColorDetail(data: Uint8ClampedArray, index: number): boolean {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  return Math.max(red, green, blue) - Math.min(red, green, blue) >= 24;
}

function normalizeCanvasForPrint(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  preserveColoredDetails: boolean,
): void {
  const cornerIndexes = [
    0,
    Math.max(0, width - 1) * 4,
    Math.max(0, (height - 1) * width) * 4,
    Math.max(0, (height * width) - 1) * 4,
  ];
  const invertNeutral = (
    cornerIndexes.reduce((sum, index) => sum + luminance(data, index), 0)
    / cornerIndexes.length
  ) < 128;

  for (let index = 0; index < data.length; index += 4) {
    if (preserveColoredDetails && hasColorDetail(data, index)) continue;
    const value = Math.round(luminance(data, index));
    const normalized = invertNeutral ? 255 - value : value;
    data[index] = normalized;
    data[index + 1] = normalized;
    data[index + 2] = normalized;
  }
}

async function canvasPngPayload(
  canvas: HTMLCanvasElement,
  output: ChartExportRenderRequest["output"],
): Promise<Pick<ChartExportRenderResult, "pngBase64" | "pngBytes">> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("visible chart canvas export failed"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
  if (output === "bytes") {
    return { pngBytes: new Uint8Array(await blob.arrayBuffer()) };
  }
  const pngBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("visible chart canvas export failed"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const marker = "base64,";
      const index = value.indexOf(marker);
      resolve(index >= 0 ? value.slice(index + marker.length) : value);
    };
    reader.readAsDataURL(blob);
  });
  return { pngBase64 };
}

/** Export the exact retained specialized canvas registered by the visible
 * surface. File -> Export must never silently substitute a standard wheel. */
export async function renderCanvasChartExport(
  source: HTMLCanvasElement,
  request: ChartExportRenderRequest,
): Promise<ChartExportRenderResult> {
  const canvas = document.createElement("canvas");
  const squarePng = request.kind === "png";
  canvas.width = squarePng ? PNG_EXPORT_PIXEL_SIZE : Math.max(1, source.width);
  canvas.height = squarePng ? PNG_EXPORT_PIXEL_SIZE : Math.max(1, source.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("visible chart canvas export context unavailable");
  context.fillStyle = request.colorMode === "screen" ? cssBackgroundColor(source) : "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  const drawX = (canvas.width - drawWidth) / 2;
  const drawY = (canvas.height - drawHeight) / 2;
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  if (request.kind === "pdf") {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    applyPdfRasterPreset(
      image.data,
      image.width,
      image.height,
      request.rasterPreset,
      request.colorMode === "colored-details",
    );
    context.putImageData(image, 0, 0);
  } else if (request.colorMode !== "screen") {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    normalizeCanvasForPrint(
      image.data,
      image.width,
      image.height,
      request.colorMode === "colored-details",
    );
    context.putImageData(image, 0, 0);
  }
  return {
    ...await canvasPngPayload(canvas, request.output),
    width: canvas.width,
    height: canvas.height,
  };
}

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
