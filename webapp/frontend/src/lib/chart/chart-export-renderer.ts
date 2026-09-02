// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanvasDraw } from "./canvas-draw";
import { morinusTextFontFromTokens } from "./chart-fonts";
import { radixOverlayTopLeftLines } from "./chart-overlay-lines";
import { drawSnapshotLayer, type ClickAspectState } from "./draw-chart";
import {
  applyProfileColorsToSnapshot,
  readPaletteFromTheme,
  readPaletteProfileOverrides,
} from "./palette";
import {
  resolveWheelOverlayMetrics,
  resolveWheelRenderStyleFromTokens,
  resolveWheelTypographyPaint,
  type ResolvedWheelTypographyPaint,
  type WheelAuthoringTypographyClass,
  type WheelCssValueReader,
  type WheelRenderStyle,
  type WheelTypographyProfile,
} from "./wheel-render-style";
import { applyPdfRasterPreset } from "./pdf-raster-presets";
import { compileFlatWheelAuthoringOverrides } from "../style-lab/wheel-authoring-adapter";
import type {
  Chart,
  ChartPalette,
  ChartPlanet,
  ChartRenderSnapshot,
  OverlayInfoRow,
} from "./types";
import type { ThemeState } from "@/lib/daemon/client";
import type {
  ChartExportRenderRequest,
  ChartExportRenderResult,
} from "./chart-export-registry";

const EXPORT_LONG_EDGE = 1200;
const PNG_EXPORT_DPR = 1;
const PDF_EXPORT_DPR = 2;
const PDF_EXPORT_WIDTH = 900;
const PDF_EXPORT_HEIGHT = 1200;
const PRINT_BLACK = "rgb(0 0 0)";
const PRINT_WHITE = "rgb(255 255 255)";

function exportDimensions(): { width: number; height: number } {
  return { width: EXPORT_LONG_EDGE, height: EXPORT_LONG_EDGE };
}

function resolvedThemeTokenReader(theme: ThemeState | null): WheelCssValueReader {
  const values = {
    ...(theme?.appTokens ?? {}),
    ...(theme?.chartPalette ?? {}),
    ...(theme?.profileOverrides?.appTokens ?? {}),
    ...(theme?.profileOverrides?.chartPalette ?? {}),
  };
  const resolve = (cssVar: string, stack: ReadonlySet<string>): string => {
    if (stack.has(cssVar)) return "";
    const raw = values[cssVar]?.trim() ?? "";
    if (!raw.includes("var(")) return raw;
    const nextStack = new Set(stack);
    nextStack.add(cssVar);
    return raw.replace(
      /var\(\s*(--[A-Za-z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)/g,
      (_match, reference: string, fallback: string | undefined) =>
        resolve(reference, nextStack) || fallback?.trim() || "",
    ).trim();
  };
  return (cssVar) => resolve(cssVar, new Set());
}

function resolvedThemeForExport(theme: ThemeState | null): ThemeState | null {
  if (!theme) return null;
  const read = resolvedThemeTokenReader(theme);
  const resolveRecord = (values: Record<string, string>) => Object.fromEntries(
    Object.keys(values).map((cssVar) => [cssVar, read(cssVar) || values[cssVar]]),
  );
  return {
    ...theme,
    appTokens: resolveRecord(theme.appTokens),
    chartPalette: resolveRecord(theme.chartPalette),
    profileOverrides: {
      ...theme.profileOverrides,
      appTokens: resolveRecord(theme.profileOverrides.appTokens),
      chartPalette: resolveRecord(theme.profileOverrides.chartPalette),
    },
  };
}

function resolveRoleFont(
  readValue: WheelCssValueReader,
  cssVar: string,
  fallback: string,
): string {
  const value = readValue(cssVar)?.trim();
  return value && !value.startsWith("var(") ? value : fallback;
}

function resolveScreenStyle(
  chart: ChartRenderSnapshot,
  theme: ThemeState | null,
): {
  snapshot: ChartRenderSnapshot;
  style: WheelRenderStyle;
  palette: ChartPalette;
  readValue: WheelCssValueReader;
} {
  const resolvedTheme = resolvedThemeForExport(theme);
  const readValue = resolvedThemeTokenReader(resolvedTheme);
  const palette = {
    ...readPaletteFromTheme(resolvedTheme),
    ...(chart.primaryChart.palette ?? {}),
    ...readPaletteProfileOverrides(resolvedTheme),
  };
  const snapshot = applyProfileColorsToSnapshot(chart, resolvedTheme);
  const inheritedText = morinusTextFontFromTokens(resolvedTheme?.appTokens);
  const wheelText = readValue("--aries-wheel-font-text")?.trim();
  const fontUi = wheelText && !wheelText.startsWith("var(") ? wheelText : inheritedText;
  const inheritedSymbols =
    readValue("--aries-font-symbols")?.trim() || '"AriesMorinus"';
  const wheelSymbols = readValue("--aries-wheel-font-symbols")?.trim();
  const fontSymbols =
    wheelSymbols && !wheelSymbols.startsWith("var(") ? wheelSymbols : inheritedSymbols;
  const style = resolveWheelRenderStyleFromTokens(
    readValue,
    {
      palette,
      revision: `${resolvedTheme?.styleRevision ?? "base"}:chart-export`,
      fontUi,
      fontSymbols,
      fontBodySymbols: resolveRoleFont(readValue, "--aries-wheel-font-body-symbols", fontSymbols),
      fontSignSymbols: resolveRoleFont(readValue, "--aries-wheel-font-sign-symbols", fontSymbols),
      fontTermSymbols: resolveRoleFont(readValue, "--aries-wheel-font-term-symbols", fontSymbols),
      fontDecanSymbols: resolveRoleFont(readValue, "--aries-wheel-font-decan-symbols", fontSymbols),
      fontAspectSymbols: resolveRoleFont(readValue, "--aries-wheel-font-aspect-symbols", fontSymbols),
      authoringOverrides: compileFlatWheelAuthoringOverrides(
        resolvedTheme?.profileOverrides?.wheelAuthoring ?? {},
      ),
    },
  );
  return { snapshot, style, palette, readValue };
}

function parseCssRgb(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!values || values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return values.map((value) => Math.max(0, Math.min(255, Math.round(value)))) as [number, number, number];
}

function readablePrintColor(color: string): string {
  const rgb = parseCssRgb(color);
  if (!rgb || Math.max(...rgb) - Math.min(...rgb) < 24) return PRINT_BLACK;
  const luminance = (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
  if (luminance <= 176) return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
  const factor = 176 / luminance;
  return `rgb(${rgb.map((value) => Math.round(value * factor)).join(" ")})`;
}

function printPalette(
  palette: ChartPalette,
  request: ChartExportRenderRequest,
): ChartPalette {
  const coloredDetails = request.colorMode === "colored-details";
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
    domicil: coloredDetails && request.dignityHighlights ? readablePrintColor(palette.domicil) : PRINT_BLACK,
    exil: coloredDetails && request.dignityHighlights ? readablePrintColor(palette.exil) : PRINT_BLACK,
    exal: coloredDetails && request.dignityHighlights ? readablePrintColor(palette.exal) : PRINT_BLACK,
    casus: coloredDetails && request.dignityHighlights ? readablePrintColor(palette.casus) : PRINT_BLACK,
    textDim: PRINT_BLACK,
    textBright: PRINT_BLACK,
    fortune: PRINT_BLACK,
    planets: coloredDetails && request.individualBodyColors
      ? [...palette.planets]
      : blackArray(palette.planets),
    aspects: coloredDetails ? [...palette.aspects] : blackArray(palette.aspects),
    surveilAccent: coloredDetails ? palette.surveilAccent : PRINT_BLACK,
  };
}

function planetPaletteIndex(planet: ChartPlanet): number {
  if (planet.id === "nnode" || planet.id === "snode") return 10;
  if (planet.id === "chiron") return 12;
  return Math.max(0, Math.min(9, Number(planet.seId) || 0));
}

function printPlanetColor(
  planet: ChartPlanet,
  palette: ChartPalette,
  request: ChartExportRenderRequest,
): string {
  if (request.colorMode !== "colored-details") return PRINT_BLACK;
  if (request.dignityHighlights) {
    switch (planet.dignity) {
      case "domicil": return palette.domicil;
      case "exil": return palette.exil;
      case "exal": return palette.exal;
      case "casus": return palette.casus;
      default: return PRINT_BLACK;
    }
  }
  if (request.individualBodyColors) {
    return planet.color ?? palette.planets[planetPaletteIndex(planet)] ?? PRINT_BLACK;
  }
  return PRINT_BLACK;
}

function printChart(
  chart: Chart,
  palette: ChartPalette,
  request: ChartExportRenderRequest,
): Chart {
  const planets = chart.planets.map((planet) => ({
    ...planet,
    color: printPlanetColor(planet, palette, request),
  }));
  const colorsBySeId = new Map(planets.map((planet) => [planet.seId, planet.color ?? PRINT_BLACK]));
  const overlay = chart.overlay ? {
    ...chart.overlay,
    rows: chart.overlay.rows.map((row) => ({
      ...row,
      glyphs: row.glyphs.map((glyph) => ({
        ...glyph,
        color: glyph.kind === "planet" && glyph.seId != null
          ? (colorsBySeId.get(glyph.seId) ?? PRINT_BLACK)
          : PRINT_BLACK,
      })),
    })),
  } : chart.overlay;
  return {
    ...chart,
    planets,
    fortune: chart.fortune ? { ...chart.fortune, color: PRINT_BLACK } : chart.fortune,
    vertex: chart.vertex ? { ...chart.vertex, color: PRINT_BLACK } : chart.vertex,
    syzygy: chart.syzygy ? { ...chart.syzygy, color: PRINT_BLACK } : chart.syzygy,
    overlay,
    palette,
    options: {
      ...chart.options,
      signColors: Array.from({ length: 12 }, () => PRINT_BLACK),
      multiwheelSignColors: Array.from({ length: 12 }, () => PRINT_BLACK),
    },
  };
}

function printSnapshot(
  snapshot: ChartRenderSnapshot,
  palette: ChartPalette,
  request: ChartExportRenderRequest,
): ChartRenderSnapshot {
  const apply = (chart: Chart | null | undefined) => (
    chart ? printChart(chart, palette, request) : chart
  );
  return {
    ...snapshot,
    primaryChart: apply(snapshot.primaryChart) as Chart,
    comparisonChart: apply(snapshot.comparisonChart),
    radixChart: apply(snapshot.radixChart),
    displayAnchorChart: apply(snapshot.displayAnchorChart),
    outerRingItems: snapshot.outerRingItems
      ? Object.fromEntries(Object.entries(snapshot.outerRingItems).map(([mode, items]) => [
        mode,
        items?.map((item) => ({
          ...item,
          segments: item.segments?.map((segment) => ({ ...segment, color: PRINT_BLACK })),
        })),
      ]))
      : snapshot.outerRingItems,
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

function canvasLayer(width: number, height: number, fontUi: string, dpr: number): {
  canvas: HTMLCanvasElement;
  draw: CanvasDraw;
} {
  const canvas = document.createElement("canvas");
  const draw = new CanvasDraw(canvas);
  draw.setDefaultFont(fontUi);
  draw.resize(width, height, dpr);
  return { canvas, draw };
}

type ExportPaintLayer = "geometry" | "dynamic" | "outer-label";

function exportLayerEffect(
  readValue: WheelCssValueReader,
  layer: ExportPaintLayer,
): Readonly<{ opacity: number; filter: string }> {
  const read = (suffix: string, fallback: string) =>
    readValue(`--aries-wheel-effect-${layer}-${suffix}`)?.trim() || fallback;
  const opacityValue = Number.parseFloat(read("opacity", "1"));
  const opacity = Number.isFinite(opacityValue)
    ? Math.min(1, Math.max(0, opacityValue))
    : 1;
  const shadowX = read("shadow-offset-x", "0px");
  const shadowY = read("shadow-offset-y", "0px");
  const shadowBlur = read("shadow-blur", "0px");
  const shadowColor = read("shadow-color", "rgba(0,0,0,0)");
  return Object.freeze({
    opacity,
    filter: [
      `blur(${read("blur", "0px")})`,
      `brightness(${read("brightness-scale", "1")})`,
      `contrast(${read("contrast-scale", "1")})`,
      `saturate(${read("saturate-scale", "1")})`,
      `hue-rotate(${read("hue-rotate", "0deg")})`,
      `grayscale(${read("grayscale-opacity", "0")})`,
      `invert(${read("invert-opacity", "0")})`,
      `sepia(${read("sepia-opacity", "0")})`,
      `drop-shadow(${shadowX} ${shadowY} ${shadowBlur} ${shadowColor})`,
    ].join(" "),
  });
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
  paint: ResolvedWheelTypographyPaint,
  lineHeight: number,
  gap: number,
) {
  const rowHeight = paint.size * lineHeight;
  lines.forEach((line, index) => {
    draw.text([x, y + index * (rowHeight + gap)], line, {
      fill: paint.color,
      font: paint.font,
      size: paint.size,
      weight: paint.weight,
      style: paint.style,
      tracking: paint.tracking,
      opacity: paint.opacity,
      align,
    });
  });
}

const EVENT_OVERLAY_CLASSES = Object.freeze({
  dayhour: {
    label: "chartOverlay.events.dayHour.label",
    glyph: "chartOverlay.events.dayHour.glyph",
    trailing: "chartOverlay.events.dayHour.trailing",
  },
  header: {
    label: "chartOverlay.events.header.label",
    glyph: "chartOverlay.events.header.glyph",
    trailing: "chartOverlay.events.header.trailing",
  },
  signal: {
    label: "chartOverlay.events.signal.label",
    glyph: "chartOverlay.events.signal.glyph",
    trailing: "chartOverlay.events.signal.trailing",
  },
} as const satisfies Record<
  Exclude<OverlayInfoRow["group"], undefined>,
  Record<"label" | "glyph" | "trailing", WheelAuthoringTypographyClass>
>);

function overlayTextOptions(paint: ResolvedWheelTypographyPaint) {
  return {
    fill: paint.color,
    font: paint.font,
    size: paint.size,
    weight: paint.weight,
    style: paint.style,
    tracking: paint.tracking,
    opacity: paint.opacity,
  };
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
  const overlay = resolveWheelOverlayMetrics(metrics, { width, height });
  const maxRadius = overlay.chartSize / 2;
  const profile: WheelTypographyProfile = primary.options.theme === 2
    ? "anglo"
    : primary.options.theme === 1
      ? "compact"
      : "classic";
  const fontUi = style.typography.families.ui;
  const fontSymbols = style.typography.families.symbols;
  const resolvePaint = (
    classId: WheelAuthoringTypographyClass,
    defaults: Parameters<typeof resolveWheelTypographyPaint>[4],
  ) => resolveWheelTypographyPaint(style, profile, classId, maxRadius, defaults);

  if (corner.options.showInformation) {
    const topLines = radixOverlayTopLeftLines(corner, snapshot.radixChart);
    const topPaint = resolvePaint("chartOverlay.information.topLeft", {
      font: fontUi,
      size: overlay.infoFontSize,
      color: palette.textDim,
    });
    drawCornerLines(
      draw, topLines, overlay.edgeInset, overlay.topEdgeInset, "left",
      topPaint, metrics.cornerLineHeight, metrics.infoGap,
    );
    const bottomLines = corner.meta.cornerLines?.bottomLeft ?? [corner.meta.place, corner.meta.placeCoords];
    const bottomPaint = resolvePaint("chartOverlay.information.bottomLeft", {
      font: fontUi,
      size: overlay.infoFontSize,
      color: palette.textDim,
    });
    const bottomHeight = bottomLines.length * bottomPaint.size * metrics.cornerLineHeight +
      Math.max(0, bottomLines.length - 1) * metrics.infoGap;
    drawCornerLines(
      draw, bottomLines, overlay.edgeInset, height - overlay.edgeInset - bottomHeight,
      "left", bottomPaint, metrics.cornerLineHeight, metrics.infoGap,
    );
  }

  if (display.options.showHouseSystem) {
    const lines = display.meta.houseSystemLines ?? [];
    const paint = resolvePaint("chartOverlay.houseSystem.bottomRight", {
      font: fontUi,
      size: overlay.infoFontSize,
      color: palette.textDim,
    });
    const blockHeight = lines.length * paint.size * metrics.cornerLineHeight +
      Math.max(0, lines.length - 1) * metrics.infoGap;
    drawCornerLines(
      draw, lines, width - overlay.edgeInset, height - overlay.edgeInset - blockHeight,
      "right", paint, metrics.cornerLineHeight, metrics.infoGap,
    );
  }

  const sections = splitOverlayRows(display.overlay?.rows ?? []);
  const rows: Array<OverlayInfoRow | { spacer: number }> = [...sections.dayhour];
  if (sections.dayhour.length && sections.header.length) {
    rows.push({ spacer: overlay.gapAfterDayHour });
  }
  rows.push(...sections.header);
  if ((sections.dayhour.length || sections.header.length) && sections.signal.length) {
    rows.push({ spacer: overlay.gapBetweenGroups });
  }
  rows.push(...sections.signal);
  if (!rows.length) return;

  const prepared = rows.map((row) => {
    if ("spacer" in row) return row;
    const group = row.group ?? "signal";
    const classes = EVENT_OVERLAY_CLASSES[group];
    const labelPaint = resolvePaint(classes.label, {
      font: fontUi,
      size: overlay.labelSize,
      color: palette.textDim,
    });
    const first = row.glyphs[0];
    const glyphPaint = resolvePaint(classes.glyph, {
      font: fontSymbols,
      size: overlay.iconSize,
      color: first ? glyphColor(first, palette) : palette.textDim,
    });
    const second = group === "header" ? row.glyphs[1] : null;
    const trailingPaint = resolvePaint(classes.trailing, {
      font: second ? fontSymbols : fontUi,
      size: second ? overlay.iconSize : overlay.labelSize,
      color: second ? glyphColor(second, palette) : palette.textDim,
    });
    const rowHeight = Math.max(
      overlay.lineHeight,
      Math.round(
        Math.max(labelPaint.size, glyphPaint.size, trailingPaint.size)
        * metrics.fontBoxScale
        * metrics.rowHeightFactor,
      ),
    );
    return { row, labelPaint, glyphPaint, trailingPaint, rowHeight };
  });

  const gap = overlay.columnGap;
  let labelWidth = 0;
  let firstWidth = 0;
  let trailingWidth = 0;
  for (const item of prepared) {
    if ("spacer" in item) continue;
    const { row, labelPaint, glyphPaint, trailingPaint } = item;
    labelWidth = Math.max(
      labelWidth,
      draw.textsize(row.label, overlayTextOptions(labelPaint))[0],
    );
    const first = row.glyphs[0];
    if (first) {
      firstWidth = Math.max(
        firstWidth,
        draw.textsize(first.char, overlayTextOptions(glyphPaint))[0],
      );
    }
    const second = row.group === "header" ? row.glyphs[1] : null;
    const trailing = second?.char ?? row.trailing ?? "";
    trailingWidth = Math.max(
      trailingWidth,
      draw.textsize(trailing, overlayTextOptions(trailingPaint))[0],
    );
  }
  const startX = width - overlay.edgeInset - labelWidth - firstWidth - trailingWidth - gap * 2;
  let y = overlay.topEdgeInset;
  for (const item of prepared) {
    if ("spacer" in item) {
      y += item.spacer;
      continue;
    }
    const { row, labelPaint, glyphPaint, trailingPaint, rowHeight } = item;
    const labelY = y + Math.max(0, (rowHeight - labelPaint.size) / 2);
    const glyphY = y + Math.max(0, (rowHeight - glyphPaint.size) / 2);
    const trailingY = y + Math.max(0, (rowHeight - trailingPaint.size) / 2);
    draw.text([startX, labelY], row.label, overlayTextOptions(labelPaint));
    const first = row.glyphs[0];
    if (first) {
      draw.text([startX + labelWidth + gap, glyphY], first.char, {
        ...overlayTextOptions(glyphPaint),
      });
    }
    const second = row.group === "header" ? row.glyphs[1] : null;
    if (second) {
      draw.text([startX + labelWidth + gap + firstWidth + gap, trailingY], second.char, {
        ...overlayTextOptions(trailingPaint),
      });
    } else if (row.trailing) {
      draw.text([startX + labelWidth + gap + firstWidth + gap, trailingY], row.trailing, {
        ...overlayTextOptions(trailingPaint),
      });
    }
    y += rowHeight;
  }
}

async function canvasPngPayload(
  canvas: HTMLCanvasElement,
  output: ChartExportRenderRequest["output"],
): Promise<Pick<ChartExportRenderResult, "pngBase64" | "pngBytes">> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("chart export canvas did not produce PNG data"));
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
    reader.onerror = () => reject(reader.error ?? new Error("could not read chart export PNG"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const marker = "base64,";
      const index = value.indexOf(marker);
      if (index < 0) reject(new Error("chart export PNG encoding failed"));
      else resolve(value.slice(index + marker.length));
    };
    reader.readAsDataURL(blob);
  });
  return { pngBase64 };
}

function applyPdfRasterTreatment(
  canvas: HTMLCanvasElement,
  request: ChartExportRenderRequest,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyPdfRasterPreset(
    image.data,
    image.width,
    image.height,
    request.rasterPreset,
    request.colorMode === "colored-details",
  );
  ctx.putImageData(image, 0, 0);
}

export async function renderChartSurfaceExport(
  chart: ChartRenderSnapshot,
  theme: ThemeState | null,
  viewport: { width: number; height: number },
  request: ChartExportRenderRequest,
  clickAspectState?: ClickAspectState,
): Promise<ChartExportRenderResult> {
  const size = request.kind === "pdf"
    ? { width: PDF_EXPORT_WIDTH, height: PDF_EXPORT_HEIGHT }
    : exportDimensions();
  const screen = resolveScreenStyle(chart, theme);
  const usesPrintAppearance = request.kind === "pdf" || request.colorMode !== "screen";
  const palette = usesPrintAppearance
    ? printPalette(screen.palette, request)
    : screen.palette;
  const style = usesPrintAppearance ? printStyle(screen.style, palette) : screen.style;
  const snapshot = usesPrintAppearance
    ? printSnapshot(screen.snapshot, palette, request)
    : screen.snapshot;
  const dpr = request.kind === "png" ? PNG_EXPORT_DPR : PDF_EXPORT_DPR;
  const layers = (["fill", "geometry", "dynamic", "outer-label"] as const).map((layer) => {
    const item = canvasLayer(size.width, size.height, style.typography.families.ui, dpr);
    drawSnapshotLayer(item.draw, snapshot, layer, {
      width: size.width,
      height: size.height,
      chartSize: Math.min(size.width, size.height),
      renderStyle: style,
      geometryOwnsBackground: false,
      ...(layer === "dynamic" ? { clickAspectState } : {}),
    });
    return { layer, canvas: item.canvas };
  });
  const output = canvasLayer(size.width, size.height, style.typography.families.ui, dpr);
  for (const item of layers) {
    output.draw.ctx.save();
    if (item.layer !== "fill") {
      const effect = exportLayerEffect(screen.readValue, item.layer);
      output.draw.ctx.globalAlpha = effect.opacity;
      output.draw.ctx.filter = effect.filter;
    }
    output.draw.ctx.drawImage(item.canvas, 0, 0, size.width, size.height);
    output.draw.ctx.restore();
  }
  if (request.includeOverlays) {
    drawSurfaceOverlays(output.draw, snapshot, style, size.width, size.height);
  }
  if (request.kind === "pdf") {
    applyPdfRasterTreatment(output.canvas, request);
  }
  return {
    ...await canvasPngPayload(output.canvas, request.output),
    width: output.canvas.width,
    height: output.canvas.height,
  };
}
