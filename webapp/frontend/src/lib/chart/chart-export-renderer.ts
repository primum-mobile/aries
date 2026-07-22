// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanvasDraw } from "./canvas-draw";
import { morinusTextFontFromTokens } from "./chart-fonts";
import { drawSnapshotLayer } from "./draw-chart";
import {
  applyProfileColorsToSnapshot,
  readPaletteFromTheme,
  readPaletteProfileOverrides,
} from "./palette";
import { resolveWheelRenderStyleFromTokens, type WheelRenderStyle } from "./wheel-render-style";
import type { ChartPalette, ChartRenderSnapshot, OverlayInfoRow } from "./types";
import type { ThemeState } from "@/lib/daemon/client";
import type {
  ChartExportRenderRequest,
  ChartExportRenderResult,
} from "./chart-export-registry";

const EXPORT_LONG_EDGE = 1200;
const EXPORT_DPR = 2;
const PRINT_BLACK = "rgb(0 0 0)";
const PRINT_WHITE = "rgb(255 255 255)";

function exportDimensions(width: number, height: number): { width: number; height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = EXPORT_LONG_EDGE / Math.max(safeWidth, safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function resolveRoleFont(theme: ThemeState | null, cssVar: string, fallback: string): string {
  const value = theme?.chartPalette?.[cssVar]?.trim();
  return value && !value.startsWith("var(") ? value : fallback;
}

function resolveScreenStyle(
  chart: ChartRenderSnapshot,
  theme: ThemeState | null,
): { snapshot: ChartRenderSnapshot; style: WheelRenderStyle; palette: ChartPalette } {
  const palette = {
    ...readPaletteFromTheme(theme),
    ...(chart.primaryChart.palette ?? {}),
    ...readPaletteProfileOverrides(theme),
  };
  const snapshot = applyProfileColorsToSnapshot(chart, theme);
  const inheritedText = morinusTextFontFromTokens(theme?.appTokens);
  const wheelText = theme?.chartPalette?.["--aries-wheel-font-text"]?.trim();
  const fontUi = wheelText && !wheelText.startsWith("var(") ? wheelText : inheritedText;
  const inheritedSymbols =
    theme?.appTokens?.["--aries-font-symbols"]?.trim() || '"AriesMorinus"';
  const wheelSymbols = theme?.chartPalette?.["--aries-wheel-font-symbols"]?.trim();
  const fontSymbols =
    wheelSymbols && !wheelSymbols.startsWith("var(") ? wheelSymbols : inheritedSymbols;
  const style = resolveWheelRenderStyleFromTokens(
    (cssVar) => theme?.chartPalette?.[cssVar],
    {
      palette,
      revision: `${theme?.styleRevision ?? "base"}:chart-export`,
      fontUi,
      fontSymbols,
      fontBodySymbols: resolveRoleFont(theme, "--aries-wheel-font-body-symbols", fontSymbols),
      fontSignSymbols: resolveRoleFont(theme, "--aries-wheel-font-sign-symbols", fontSymbols),
      fontTermSymbols: resolveRoleFont(theme, "--aries-wheel-font-term-symbols", fontSymbols),
      fontDecanSymbols: resolveRoleFont(theme, "--aries-wheel-font-decan-symbols", fontSymbols),
      fontAspectSymbols: resolveRoleFont(theme, "--aries-wheel-font-aspect-symbols", fontSymbols),
    },
  );
  return { snapshot, style, palette };
}

function printPalette(palette: ChartPalette, coloredDetails: boolean): ChartPalette {
  const blackArray = (values: string[]) => values.map(() => PRINT_BLACK);
  return {
    ...palette,
    background: PRINT_WHITE,
    frame: PRINT_BLACK,
    signs: PRINT_BLACK,
    angles: PRINT_BLACK,
    houses: PRINT_BLACK,
    houseNums: PRINT_BLACK,
    positions: PRINT_BLACK,
    peregrin: PRINT_BLACK,
    domicil: coloredDetails ? palette.domicil : PRINT_BLACK,
    exil: coloredDetails ? palette.exil : PRINT_BLACK,
    exal: coloredDetails ? palette.exal : PRINT_BLACK,
    casus: coloredDetails ? palette.casus : PRINT_BLACK,
    textDim: PRINT_BLACK,
    textBright: PRINT_BLACK,
    fortune: coloredDetails ? palette.fortune : PRINT_BLACK,
    planets: coloredDetails ? [...palette.planets] : blackArray(palette.planets),
    aspects: coloredDetails ? [...palette.aspects] : blackArray(palette.aspects),
    surveilAccent: coloredDetails ? palette.surveilAccent : PRINT_BLACK,
  };
}

function printStyle(style: WheelRenderStyle, palette: ChartPalette): WheelRenderStyle {
  return {
    ...style,
    palette,
    elementColors: Object.fromEntries(
      Object.keys(style.elementColors).map((key) => [key, PRINT_BLACK]),
    ) as unknown as WheelRenderStyle["elementColors"],
  };
}

function canvasLayer(width: number, height: number, fontUi: string): {
  canvas: HTMLCanvasElement;
  draw: CanvasDraw;
} {
  const canvas = document.createElement("canvas");
  const draw = new CanvasDraw(canvas);
  draw.setDefaultFont(fontUi);
  draw.resize(width, height, EXPORT_DPR);
  return { canvas, draw };
}

function splitOverlayRows(rows: OverlayInfoRow[]) {
  return {
    dayhour: rows.filter((row) => row.group === "dayhour"),
    header: rows.filter((row) => row.group === "header"),
    signal: rows.filter((row) => row.group === "signal"),
  };
}

function glyphColor(glyph: OverlayInfoRow["glyphs"][number], palette: ChartPalette): string {
  return glyph.color ?? (
    glyph.kind === "planet" && glyph.seId != null
      ? (palette.planets[glyph.seId] ?? palette.textDim)
      : palette.textDim
  );
}

function drawCornerLines(
  draw: CanvasDraw,
  lines: string[],
  x: number,
  y: number,
  align: CanvasTextAlign,
  fontSize: number,
  lineHeight: number,
  gap: number,
  color: string,
  fontUi: string,
) {
  const rowHeight = fontSize * lineHeight;
  lines.forEach((line, index) => {
    draw.text([x, y + index * (rowHeight + gap)], line, {
      fill: color,
      font: fontUi,
      size: fontSize,
      align,
    });
  });
}

function drawSurfaceOverlays(
  draw: CanvasDraw,
  snapshot: ChartRenderSnapshot,
  style: WheelRenderStyle,
  width: number,
  height: number,
) {
  const primary = snapshot.primaryChart;
  const display = snapshot.comparisonChart ?? primary;
  const primaryCorners = primary.meta.cornerLines;
  const corner = primaryCorners?.topLeft?.length || primaryCorners?.bottomLeft?.length
    ? primary
    : display;
  const palette = style.palette as ChartPalette;
  const metrics = style.overlays;
  const chartSize = Math.min(width, height);
  const compact = width <= metrics.compactBreakpoint;
  const symbolSize = chartSize / 32;
  const infoSize = Math.max(
    compact ? metrics.compactInfoFontMin : metrics.infoFontMin,
    symbolSize * (compact ? metrics.compactInfoFontScale : metrics.infoFontScale),
  );
  const iconSize = Math.max(
    compact ? metrics.compactIconMin : metrics.iconMin,
    ((2 * symbolSize) / 3) * (compact ? metrics.compactIconScale : metrics.iconScale),
  );
  const labelSize = Math.max(
    compact ? metrics.compactLabelMin : metrics.labelMin,
    symbolSize * (compact ? metrics.compactLabelScale : metrics.labelScale),
  );
  const rowHeight = Math.max(
    1,
    Math.round(Math.max(iconSize, labelSize) * metrics.fontBoxScale * metrics.rowHeightFactor),
  );
  const edge = Math.max(compact ? metrics.compactEdgeInsetMin : 0, chartSize * metrics.edgeInsetScale);
  const top = compact ? edge : edge + metrics.titlebarSafeTop;
  const fontUi = style.typography.families.ui;
  const fontSymbols = style.typography.families.symbols;

  if (corner.options.showInformation) {
    const topLines = corner.meta.cornerLines?.topLeft ?? [corner.meta.dateDisplay, corner.meta.timeDisplay];
    drawCornerLines(
      draw, topLines, edge, top, "left", infoSize, metrics.cornerLineHeight,
      metrics.infoGap, palette.textDim, fontUi,
    );
    const bottomLines = corner.meta.cornerLines?.bottomLeft ?? [corner.meta.place, corner.meta.placeCoords];
    const bottomHeight = bottomLines.length * infoSize * metrics.cornerLineHeight +
      Math.max(0, bottomLines.length - 1) * metrics.infoGap;
    drawCornerLines(
      draw, bottomLines, edge, height - edge - bottomHeight, "left", infoSize,
      metrics.cornerLineHeight, metrics.infoGap, palette.textDim, fontUi,
    );
  }

  if (display.options.showHouseSystem) {
    const lines = display.meta.houseSystemLines ?? [];
    const blockHeight = lines.length * infoSize * metrics.cornerLineHeight +
      Math.max(0, lines.length - 1) * metrics.infoGap;
    drawCornerLines(
      draw, lines, width - edge, height - edge - blockHeight, "right", infoSize,
      metrics.cornerLineHeight, metrics.infoGap, palette.textDim, fontUi,
    );
  }

  const sections = splitOverlayRows(display.overlay?.rows ?? []);
  const rows: Array<OverlayInfoRow | { spacer: number }> = [...sections.dayhour];
  if (sections.dayhour.length && sections.header.length) {
    rows.push({ spacer: Math.round(rowHeight * metrics.gapAfterDayHourScale) });
  }
  rows.push(...sections.header);
  if ((sections.dayhour.length || sections.header.length) && sections.signal.length) {
    rows.push({ spacer: Math.round(rowHeight * metrics.groupGapScale) });
  }
  rows.push(...sections.signal);
  if (!rows.length) return;

  const gap = Math.max(metrics.columnGapMin, Math.floor(symbolSize * metrics.columnGapScale));
  let labelWidth = 0;
  let firstWidth = 0;
  let trailingWidth = 0;
  for (const row of rows) {
    if ("spacer" in row) continue;
    labelWidth = Math.max(labelWidth, draw.textsize(row.label, { font: fontUi, size: labelSize })[0]);
    const first = row.glyphs[0];
    if (first) firstWidth = Math.max(firstWidth, draw.textsize(first.char, { font: fontSymbols, size: iconSize })[0]);
    const second = row.group === "header" ? row.glyphs[1] : null;
    const trailing = second?.char ?? row.trailing ?? "";
    trailingWidth = Math.max(
      trailingWidth,
      draw.textsize(trailing, { font: second ? fontSymbols : fontUi, size: second ? iconSize : labelSize })[0],
    );
  }
  const startX = width - edge - labelWidth - firstWidth - trailingWidth - gap * 2;
  let y = top;
  for (const row of rows) {
    if ("spacer" in row) {
      y += row.spacer;
      continue;
    }
    const textY = y + Math.max(0, (rowHeight - labelSize) / 2);
    const glyphY = y + Math.max(0, (rowHeight - iconSize) / 2);
    draw.text([startX, textY], row.label, { fill: palette.textDim, font: fontUi, size: labelSize });
    const first = row.glyphs[0];
    if (first) {
      draw.text([startX + labelWidth + gap, glyphY], first.char, {
        fill: glyphColor(first, palette), font: fontSymbols, size: iconSize,
      });
    }
    const second = row.group === "header" ? row.glyphs[1] : null;
    if (second) {
      draw.text([startX + labelWidth + gap + firstWidth + gap, glyphY], second.char, {
        fill: glyphColor(second, palette), font: fontSymbols, size: iconSize,
      });
    } else if (row.trailing) {
      draw.text([startX + labelWidth + gap + firstWidth + gap, textY], row.trailing, {
        fill: palette.textDim, font: fontUi, size: labelSize,
      });
    }
    y += rowHeight;
  }
}

function canvasPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("chart export canvas did not produce PNG data"));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("could not read chart export PNG"));
      reader.onload = () => {
        const value = String(reader.result ?? "");
        const marker = "base64,";
        const index = value.indexOf(marker);
        if (index < 0) reject(new Error("chart export PNG encoding failed"));
        else resolve(value.slice(index + marker.length));
      };
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

function convertCanvasToMonochrome(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = Math.min(image.data[index], image.data[index + 1], image.data[index + 2]);
    image.data[index] = gray;
    image.data[index + 1] = gray;
    image.data[index + 2] = gray;
  }
  ctx.putImageData(image, 0, 0);
}

export async function renderChartSurfaceExport(
  chart: ChartRenderSnapshot,
  theme: ThemeState | null,
  viewport: { width: number; height: number },
  request: ChartExportRenderRequest,
): Promise<ChartExportRenderResult> {
  const size = exportDimensions(viewport.width, viewport.height);
  const screen = resolveScreenStyle(chart, theme);
  const isPdf = request.kind === "pdf";
  const palette = isPdf
    ? printPalette(screen.palette, request.colorMode === "colored-details")
    : screen.palette;
  const style = isPdf ? printStyle(screen.style, palette) : screen.style;
  const layers = (["geometry", "dynamic", "outer-label"] as const).map((layer) => {
    const item = canvasLayer(size.width, size.height, style.typography.families.ui);
    drawSnapshotLayer(item.draw, screen.snapshot, layer, {
      width: size.width,
      height: size.height,
      chartSize: Math.min(size.width, size.height),
      renderStyle: style,
    });
    return item.canvas;
  });
  const output = canvasLayer(size.width, size.height, style.typography.families.ui);
  for (const layer of layers) {
    output.draw.ctx.drawImage(layer, 0, 0, size.width, size.height);
  }
  if (request.includeOverlays) {
    drawSurfaceOverlays(output.draw, screen.snapshot, style, size.width, size.height);
  }
  if (isPdf && request.colorMode === "monochrome") {
    convertCanvasToMonochrome(output.canvas);
  }
  return {
    pngBase64: await canvasPngBase64(output.canvas),
    width: output.canvas.width,
    height: output.canvas.height,
  };
}
