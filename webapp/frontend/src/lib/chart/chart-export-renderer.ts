// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanvasDraw, setCanvasDeviceFrame, type CanvasDeviceFrame } from "./canvas-draw";
import { drawPngWatermark, preparePngWatermark } from "./chart-export-watermark";
import { morinusTextFontFromTokens } from "./chart-fonts";
import { hasRelationshipCornerInformation, informationDisplayChart, informationCornerClass, radixOverlayTopLeftLines } from "./chart-overlay-lines";
import { computeHitRegions, drawSnapshotLayer, resolveChartOuterPaintEnvelope, type ClickAspectState } from "./draw-chart";
import {
  exportDashboardPlacement,
  printDashboard,
  printDashboardColor,
  substituteCssVars,
  unionRect,
} from "./chart-export-dashboard";
import { cornerOuterLabelBounds, cssColorResolver, dashboardOuterLabelBounds, dashboardShown, dashboardTextObstacles } from "./dashboard-canvas";
import { dashboardTextSize, dashboardTopLeftLines, type DashboardCorners, type DashboardLayout, type DashRect } from "./dashboard-layout";
import { paintDashboard, type DashboardPrint, type DashObstacles } from "./dashboard-paint";
import {
  applyProfileColorsToSnapshot,
  minorDignityPaletteColor,
  readPaletteFromTheme,
  readPaletteProfileOverrides,
} from "./palette";
import {
  resolveWheelOverlayMetrics,
  resolveWheelTypographyPaint,
  type ResolvedWheelTypographyPaint,
  type WheelAuthoringTypographyClass,
  type WheelCssValueReader,
  type WheelRenderStyle,
  type WheelTypographyProfile,
  wheelTypographyProfileForTheme,
} from "./wheel-render-style";
import { resolveChartPaintTarget } from "./outer-glyph-lane";
import { applyPdfRasterPreset } from "./pdf-raster-presets";
import { resolveWheelGeometryPresetStyle, resolveWheelPresetSnapshot, type WheelGeometryPresetInput } from "./wheel-geometry-preset";
import type {
  Chart,
  ChartDashboard,
  ChartPalette,
  ChartPlanet,
  ChartRenderSnapshot,
  OverlayInfoRow,
} from "./types";
import type { ThemeState } from "@/lib/daemon/client";
import type { TFunc } from "@/lib/i18n/i18n";
import type {
  ChartExportRenderRequest,
  ChartExportRenderResult,
} from "./chart-export-registry";

const EXPORT_LONG_EDGE = 1200;
const PNG_EXPORT_SIDE_GUTTER = 72;
const PNG_EXPORT_DPR = 1;
// Portrait ISO page (1:sqrt(2)) for PDFs and dashboard-view PNGs; the daemon
// keeps that shape for the PDF's printable area
// (`io_service._write_rendered_chart_pdf`). A3 is the A4 layout at a higher
// pixel density. PDFs print at about 220 dpi. PNGs fill the whole sheet: A4 at
// 300 dpi (2480 x 3508), A3 at about 280 dpi (3240 x 4583), which stays under
// WebKit's 16.7-megapixel canvas limit.
const PAGE_EXPORT_WIDTH = 900;
const PAGE_EXPORT_HEIGHT = Math.round(PAGE_EXPORT_WIDTH * Math.SQRT2);
const PDF_EXPORT_DPR = { A4: 2, A3: 2 * Math.SQRT2 } as const;
const PNG_PAGE_EXPORT_DPR = { A4: 2480 / PAGE_EXPORT_WIDTH, A3: 3.6 } as const;
const PRINT_BLACK = "rgb(0 0 0)";
const PRINT_WHITE = "rgb(255 255 255)";

function exportDimensions(hasExteriorPaint: boolean): { width: number; height: number } {
  // Exterior labels can extend past the radial wheel envelope at 3/9 o'clock.
  // Widen only those PNGs rather than reducing the wheel and its type.
  return {
    width: EXPORT_LONG_EDGE + (hasExteriorPaint ? PNG_EXPORT_SIDE_GUTTER * 2 : 0),
    height: EXPORT_LONG_EDGE,
  };
}

/** Portrait page this export paints, or null for the square or as-shown PNG.
 * PNG formats other than square apply to the dashboard view only. */
function exportPage(request: ChartExportRenderRequest, dashboard: boolean): "A4" | "A3" | null {
  if (request.kind === "pdf") return request.pageFormat === "A3" ? "A3" : "A4";
  return dashboard && (request.pageFormat === "A4" || request.pageFormat === "A3") ? request.pageFormat : null;
}

/** Canvas size and pixel density of the export. */
function exportFrame(
  request: ChartExportRenderRequest,
  dashboard: boolean,
  viewport: { width: number; height: number },
  hasExteriorPaint: boolean,
): { size: { width: number; height: number }; dpr: number } {
  if (request.kind === "png" && request.pageFormat === "viewport" && dashboard) {
    // What you see is what you get: the chart area at its on-screen size
    // and the display's pixel density.
    return {
      size: { width: Math.max(1, Math.round(viewport.width)), height: Math.max(1, Math.round(viewport.height)) },
      dpr: Math.max(1, window.devicePixelRatio || 1),
    };
  }
  const page = exportPage(request, dashboard);
  if (!page) return { size: exportDimensions(hasExteriorPaint), dpr: PNG_EXPORT_DPR };
  return {
    size: { width: PAGE_EXPORT_WIDTH, height: PAGE_EXPORT_HEIGHT },
    dpr: (request.kind === "pdf" ? PDF_EXPORT_DPR : PNG_PAGE_EXPORT_DPR)[page],
  };
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
  geometryPreview?: WheelGeometryPresetInput["preview"],
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
  const wheelPresetInput: WheelGeometryPresetInput = {
    profile: wheelTypographyProfileForTheme(chart.primaryChart.options.theme),
    presets: chart.primaryChart.options.wheelGeometryPresets,
    readAppearanceValue: readValue,
    appearanceOverrides: resolvedTheme?.profileOverrides?.wheelAuthoring ?? {},
    preview: geometryPreview,
  };
  const snapshot = resolveWheelPresetSnapshot(
    applyProfileColorsToSnapshot(chart, resolvedTheme), wheelPresetInput,
  );
  const inheritedText = morinusTextFontFromTokens(resolvedTheme?.appTokens);
  const wheelText = readValue("--aries-wheel-font-text")?.trim();
  const fontUi = wheelText && !wheelText.startsWith("var(") ? wheelText : inheritedText;
  const inheritedSymbols =
    readValue("--aries-font-symbols")?.trim() || '"AriesMorinus"';
  const wheelSymbols = readValue("--aries-wheel-font-symbols")?.trim();
  const fontSymbols =
    wheelSymbols && !wheelSymbols.startsWith("var(") ? wheelSymbols : inheritedSymbols;
  const style = resolveWheelGeometryPresetStyle(
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
    },
    wheelPresetInput,
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
  const blackArray = (values: readonly string[]) => values.map(() => PRINT_BLACK);
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
    minorDignities: coloredDetails && request.dignityHighlights
      ? (palette.minorDignities ?? []).map(readablePrintColor)
      : blackArray(palette.minorDignities ?? []),
    elements: coloredDetails
      ? [...(palette.elements ?? [])]
      : blackArray(palette.elements ?? []),
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
  if (planet.id === "apogee") return 1;
  return Math.max(0, Math.min(9, Number(planet.seId) || 0));
}

function printPlanetColor(
  planet: ChartPlanet,
  palette: ChartPalette,
  request: ChartExportRenderRequest,
  blendMinorDignities: boolean,
): string {
  if (request.colorMode !== "colored-details") return PRINT_BLACK;
  if (request.dignityHighlights) {
    switch (planet.dignity) {
      case "domicil": return palette.domicil;
      case "exil": return palette.exil;
      case "exal": return palette.exal;
      case "casus": return palette.casus;
      case "peregrin": return minorDignityPaletteColor(
        palette, planet.minorDignityCount ?? 0, blendMinorDignities,
      ) ?? PRINT_BLACK;
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
    color: printPlanetColor(planet, palette, request, chart.options.blendMinorDignities === true),
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
    authoringOverrides: {
      ...style.authoringOverrides,
      linePaint: Object.fromEntries(Object.entries(style.authoringOverrides.linePaint).map(([profile, classes]) => [
        profile,
        Object.fromEntries(Object.entries(classes).map(([classId, paint]) => [
          classId, paint,
        ])),
      ])),
    },
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
): DashRect | null {
  const rowHeight = paint.size * lineHeight;
  let w = 0;
  lines.forEach((line, index) => {
    draw.text([x, y + index * (rowHeight + gap)], line, { ...overlayTextOptions(paint), align });
    w = Math.max(w, draw.textsize(line, overlayTextOptions(paint))[0]);
  });
  if (!lines.length) return null;
  const h = lines.length * rowHeight + Math.max(0, lines.length - 1) * gap;
  return { x: align === "right" ? x - w : x, y, w, h };
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

/**
 * Paints the corner text and PNG watermark and returns their boxes, the
 * export's counterpart of the DOM corner overlays the dashboard layout clears
 * (`dashboard-canvas.ts` `measureCornerBoxes`). The watermark joins the
 * top-left box it sits under.
 */
export function drawSurfaceOverlays(
  draw: CanvasDraw,
  snapshot: ChartRenderSnapshot,
  style: WheelRenderStyle,
  width: number,
  height: number,
  request: ChartExportRenderRequest,
): DashboardCorners {
  const corners: DashboardCorners = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  const primary = snapshot.primaryChart;
  const display = informationDisplayChart(snapshot);
  const primaryCorners = primary.meta.cornerLines;
  const corner = primaryCorners?.topLeft?.length || primaryCorners?.bottomLeft?.length
    ? primary
    : display;
  const palette = style.palette as ChartPalette;
  const metrics = style.overlays;
  const overlay = resolveWheelOverlayMetrics(metrics, { width, height });
  const maxRadius = overlay.chartSize / 2;
  const profile: WheelTypographyProfile = wheelTypographyProfileForTheme(primary.options.theme);
  const fontUi = style.typography.families.ui;
  const fontSymbols = style.typography.families.symbols;
  const resolvePaint = (
    classId: WheelAuthoringTypographyClass,
    defaults: Parameters<typeof resolveWheelTypographyPaint>[4],
  ) => resolveWheelTypographyPaint(style, profile, classId, maxRadius, defaults);

  // Chart dashboard: one top-left chart-data block (date/time, place, house
  // system) at the module text size; the bottom corners stay empty.
  const merged = dashboardShown(snapshot.dashboard);
  const topPaint = resolvePaint("chartOverlay.information.topLeft", {
    font: fontUi,
    size: merged ? dashboardTextSize(width, height) : overlay.infoFontSize,
    color: palette.textDim,
  });
  let watermarkY = overlay.topEdgeInset;
  let watermarkWidth = width - 2 * overlay.edgeInset;
  const showInformation = request.includeOverlays && corner.options.showInformation
    && !(style.presentation === "traditional-morinus" && primary.options.showInformation
      && !hasRelationshipCornerInformation(primary));
  const placeLines = corner.meta.cornerLines?.bottomLeft ?? [corner.meta.place, corner.meta.placeCoords];
  const houseLines = request.includeOverlays && display.options.showHouseSystem ? display.meta.houseSystemLines ?? [] : [];
  if (showInformation || (merged && houseLines.length)) {
    const topLines = merged
      ? dashboardTopLeftLines(
        showInformation ? radixOverlayTopLeftLines(corner, snapshot.radixChart) : [],
        showInformation ? placeLines : [],
        houseLines,
      )
      : radixOverlayTopLeftLines(corner, snapshot.radixChart);
    const blockHeight = topLines.length * topPaint.size * metrics.cornerLineHeight
      + Math.max(0, topLines.length - 1) * metrics.infoGap;
    const box = drawCornerLines(
      draw, topLines, overlay.edgeInset, overlay.topEdgeInset, "left",
      topPaint, metrics.cornerLineHeight, metrics.infoGap,
    );
    corners.topLeft = box;
    if (topLines.length) {
      watermarkWidth = Math.max(topPaint.size, ...topLines.map((line) =>
        draw.textsize(line, overlayTextOptions(topPaint))[0]));
      watermarkY += blockHeight + topPaint.size * 0.3;
    }
  }
  if (showInformation && !merged) {
    const bottomLines = placeLines;
    const bottomPaint = resolvePaint(informationCornerClass(corner, "bottomLeft"), {
      font: fontUi,
      size: overlay.infoFontSize,
      color: palette.textDim,
    });
    const bottomHeight = bottomLines.length * bottomPaint.size * metrics.cornerLineHeight +
      Math.max(0, bottomLines.length - 1) * metrics.infoGap;
    corners.bottomLeft = drawCornerLines(
      draw, bottomLines, overlay.edgeInset, height - overlay.edgeInset - bottomHeight,
      "left", bottomPaint, metrics.cornerLineHeight, metrics.infoGap,
    );
  }

  if (request.kind === "png") {
    corners.topLeft = unionRect(corners.topLeft, drawPngWatermark(draw.ctx, width, request.watermarkLabel, {
      x: overlay.edgeInset,
      y: watermarkY,
      size: topPaint.size * 1.15,
      font: topPaint.font,
      monochrome: request.colorMode === "monochrome",
      style: request.watermarkStyle,
      color: palette.textBright,
      maxWidth: watermarkWidth,
    }));
  }
  if (!request.includeOverlays) return corners;

  if (display.options.showHouseSystem && !merged) {
    const lines = display.meta.houseSystemLines ?? [];
    const paint = resolvePaint("chartOverlay.houseSystem.bottomRight", {
      font: fontUi,
      size: overlay.infoFontSize,
      color: palette.textDim,
    });
    const blockHeight = lines.length * paint.size * metrics.cornerLineHeight +
      Math.max(0, lines.length - 1) * metrics.infoGap;
    corners.bottomRight = drawCornerLines(
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
  if (!rows.length) return corners;

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
  corners.topRight = { x: startX, y: overlay.topEdgeInset, w: width - overlay.edgeInset - startX, h: y - overlay.topEdgeInset };
  return corners;
}

function tokenPixels(readValue: WheelCssValueReader, name: string, fallback: number): number {
  const raw = readValue(name)?.trim()
    || getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Dashboard modules with the live painter. Screen appearance resolves the
 * export theme's tokens; print appearance inks them black and paints the
 * bodies in their printed wheel colours (`printSnapshot`).
 */
function paintExportDashboard(
  draw: CanvasDraw,
  snapshot: ChartRenderSnapshot,
  layout: DashboardLayout,
  style: WheelRenderStyle,
  readValue: WheelCssValueReader,
  request: ChartExportRenderRequest,
  print: boolean,
  t: TFunc,
  obstacles?: DashObstacles,
) {
  const dashboard = print
    ? printDashboard(
      snapshot.dashboard!,
      new Map(snapshot.primaryChart.planets.map((planet) => [Number(planet.seId), planet.color ?? PRINT_BLACK])),
      request.colorMode === "colored-details",
      PRINT_BLACK,
    )
    : snapshot.dashboard!;
  const resolver = cssColorResolver(document.body);
  const screenColor = (expression: string) => resolver.color(substituteCssVars(expression, readValue));
  try {
    paintDashboard(
      {
        ctx: draw.ctx,
        dashboard,
        color: print ? printDashboardColor(screenColor, PRINT_BLACK) : screenColor,
        fonts: { ui: style.typography.families.ui, symbols: style.typography.families.symbols },
        t,
        obstacles,
      },
      layout,
      {
        rule: tokenPixels(readValue, "--aries-chart-module-rule-width", 1),
        frame: tokenPixels(readValue, "--aries-chart-module-frame-width", 2),
      },
    );
  } finally {
    resolver.dispose();
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
  geometryPreview?: WheelGeometryPresetInput["preview"],
  t: TFunc = (key) => key,
): Promise<ChartExportRenderResult> {
  if (request.kind === "png") await preparePngWatermark(request.watermarkStyle);
  const screen = resolveScreenStyle(chart, theme, geometryPreview);
  const outerEnvelope = resolveChartOuterPaintEnvelope(screen.snapshot, screen.style);
  const { size, dpr } = exportFrame(
    request,
    dashboardShown(screen.snapshot.dashboard),
    viewport,
    outerEnvelope.avoidTitlebar,
  );
  const usesPrintAppearance = request.kind === "pdf" || request.colorMode !== "screen";
  const palette = usesPrintAppearance
    ? printPalette(screen.palette, request)
    : screen.palette;
  const style = usesPrintAppearance ? printStyle(screen.style, palette) : screen.style;
  const snapshot = usesPrintAppearance
    ? printSnapshot(screen.snapshot, palette, request)
    : screen.snapshot;
  // Wheel-first, as on screen (chart-canvas.tsx `resolveTarget`): the layout
  // clears reserved corner areas from stable inputs; the painted corner text
  // only feeds the Moon text's obstacles and is clipped at the wheel.
  const overlays = canvasLayer(size.width, size.height, style.typography.families.ui, dpr);
  const corners = request.includeOverlays || request.kind === "png"
    ? drawSurfaceOverlays(overlays.draw, snapshot, style, size.width, size.height, request)
    : null;
  const inset = resolveWheelOverlayMetrics(style.overlays, size).edgeInset;
  const cornerBoxes = corners ?? { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  const placement = exportDashboardPlacement(snapshot.dashboard, size, style.overlays, outerEnvelope, corners);
  const wheel = placement?.wheel ?? {
    chartSize: Math.min(size.width, size.height) / outerEnvelope.targetScale,
    center: undefined,
  };
  const wheelOptions = {
    width: size.width,
    height: size.height,
    chartSize: wheel.chartSize,
    ...(wheel.center ? { center: wheel.center } : {}),
    // As on screen: corner text and the edges, plus the dashboard's modules and reservations.
    outerLabelCollisionBounds: placement
      ? dashboardOuterLabelBounds(placement.layout, size, style.overlays, corners)
      : cornerOuterLabelBounds(corners, size),
  };
  // As on screen: the Moon text runs past its box only up to the nearest
  // painted object, taken from the wheel's hit regions.
  const dashboardObstacles = placement ? dashboardTextObstacles(
    computeHitRegions(snapshot, {
      ...wheelOptions,
      renderStyle: style,
      textsize: (text, options) => overlays.draw.textsize(text, options),
      textbounds: (text, options) => overlays.draw.textbounds(text, options),
      textcontour: (text, options) => overlays.draw.textcontour(text, options),
    }),
    placement.layout,
    cornerBoxes,
    { width: size.width, inset },
  ) : undefined;
  // One layer canvas at a time: a page PNG is up to 15 megapixels per canvas.
  const output = canvasLayer(size.width, size.height, style.typography.families.ui, dpr);
  for (const layer of ["fill", "geometry", "dynamic", "outer-label"] as const) {
    const item = canvasLayer(size.width, size.height, style.typography.families.ui, dpr);
    drawSnapshotLayer(item.draw, snapshot, layer, {
      ...wheelOptions,
      renderStyle: style,
      geometryOwnsBackground: false,
      includeCenterInformation: request.includeOverlays,
      ...(layer === "dynamic" ? { clickAspectState } : {}),
    });
    output.draw.ctx.save();
    if (layer !== "fill") {
      const effect = exportLayerEffect(screen.readValue, layer);
      output.draw.ctx.globalAlpha = effect.opacity;
      output.draw.ctx.filter = effect.filter;
    }
    output.draw.ctx.drawImage(item.canvas, 0, 0, size.width, size.height);
    output.draw.ctx.restore();
    item.canvas.width = 0;
    // The live dashboard canvas sits between the dynamic and outer-label layers.
    if (layer === "dynamic" && placement && snapshot.dashboard) {
      paintExportDashboard(output.draw, snapshot, placement.layout, style, screen.readValue, request, usesPrintAppearance, t, dashboardObstacles);
    }
  }
  // Corner text never moves the wheel; composited last, it draws over it.
  if (corners) output.draw.ctx.drawImage(overlays.canvas, 0, 0, size.width, size.height);
  if (request.kind === "pdf") {
    applyPdfRasterTreatment(output.canvas, request);
  }
  return {
    ...await canvasPngPayload(output.canvas, request.output),
    width: output.canvas.width,
    height: output.canvas.height,
  };
}

type PosterRect = Readonly<{ x: number; y: number; w: number; h: number }>;

/** The chart wheel in its screen style for the astrolabe poster
 * (astrolabe-poster.ts). `paint` composites the wheel's layers onto one poster
 * tile, a canvas carrying the tile's device frame: the wheel is centred in
 * `rect` of the CSS page and drawn only inside the `clip` disc, so the layer
 * fill never covers the plate or the tables beside it. */
export function posterWheelPainter(chart: ChartRenderSnapshot, theme: ThemeState | null) {
  const screen = resolveScreenStyle(chart, theme);
  const envelope = resolveChartOuterPaintEnvelope(screen.snapshot, screen.style);
  const paint = (
    target: HTMLCanvasElement,
    frame: CanvasDeviceFrame,
    page: Readonly<{ width: number; height: number }>,
    rect: PosterRect,
    clip: Readonly<{ cx: number; cy: number; r: number }>,
    dpr: number,
    includeCenterInformation: boolean,
  ) => {
    const fit = resolveChartPaintTarget(rect.w, rect.h, envelope.paintRadiusScale, 0, false, "center", envelope.targetScale);
    const center: [number, number] = [rect.x + rect.w / 2, rect.y + fit.centerY];
    const layerCanvas = document.createElement("canvas");
    setCanvasDeviceFrame(layerCanvas, frame);
    const draw = new CanvasDraw(layerCanvas);
    draw.setDefaultFont(screen.style.typography.families.ui);
    const ctx = target.getContext("2d");
    if (!ctx) return;
    try {
      for (const layer of ["fill", "geometry", "dynamic", "outer-label"] as const) {
        draw.resize(page.width, page.height, dpr);
        draw.clear();
        drawSnapshotLayer(draw, screen.snapshot, layer, {
          width: page.width,
          height: page.height,
          chartSize: fit.side,
          center,
          renderStyle: screen.style,
          geometryOwnsBackground: false,
          includeCenterInformation,
        });
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // Only the fill (the wheel's paper) is held to its disc, so it never
        // covers the plate; lines, glyphs and outer labels (fixed stars on
        // their leaders) print whole.
        if (layer === "fill") {
          ctx.beginPath();
          ctx.arc(frame.x + clip.cx * dpr, frame.y + clip.cy * dpr, clip.r * dpr, 0, Math.PI * 2);
          ctx.clip();
        } else {
          const effect = exportLayerEffect(screen.readValue, layer);
          ctx.globalAlpha = effect.opacity;
          ctx.filter = effect.filter;
        }
        ctx.drawImage(layerCanvas, 0, 0);
        ctx.restore();
      }
    } finally {
      setCanvasDeviceFrame(layerCanvas, null);
      layerCanvas.width = layerCanvas.height = 0;
    }
  };
  /** The chart dashboard's modules in the screen's appearance, as the
   * wheel export paints them (`paintExportDashboard`), at `layout`. */
  const paintModules = (draw: CanvasDraw, dashboard: ChartDashboard, layout: DashboardLayout, t: TFunc, print?: DashboardPrint) => {
    const resolver = cssColorResolver(document.body);
    try {
      paintDashboard(
        {
          ctx: draw.ctx,
          dashboard,
          color: (expression) => resolver.color(substituteCssVars(expression, screen.readValue)),
          fonts: { ui: screen.style.typography.families.ui, symbols: screen.style.typography.families.symbols },
          t,
        },
        layout,
        {
          rule: tokenPixels(screen.readValue, "--aries-chart-module-rule-width", 1),
          frame: tokenPixels(screen.readValue, "--aries-chart-module-frame-width", 2),
        },
        print,
      );
    } finally {
      resolver.dispose();
    }
  };
  return { snapshot: screen.snapshot, palette: screen.palette, fonts: screen.style.typography.families, paint, paintModules };
}
