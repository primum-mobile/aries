// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CanvasDraw } from "@/lib/chart/canvas-draw";
import {
  registerChartExportRenderer,
  renderCanvasChartExport,
} from "@/lib/chart/chart-export-registry";
import {
  registerGraphicEphemerisNavigator,
  type GraphicEphemerisNavigationKey,
  type GraphicEphemerisStepKey,
} from "@/lib/chart/graphic-ephemeris-navigation.mjs";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import { awaitFonts } from "@/lib/chart/draw-chart";
import {
  applyEphemerisPlanetProfileColors,
  DEFAULT_EPHEMERIS_RENDER_PALETTE,
  resolveEphemerisRenderPalette,
  resolveEphemerisRenderStyle,
  type EphemerisRenderStyle,
} from "@/lib/chart/ephemeris-render-style";
import { useStyleRevision } from "@/hooks/use-style-revision";
import {
  fetchEphemerisViewState,
  fetchGraphicEphemeris,
  fetchGraphicEphemerisStations,
  openDirectionsTimedChart,
  storeEphemerisViewState,
  type EphemerisColors,
  type EphemerisPayload,
  type EphemerisStation,
  type EphemerisStationsPayload,
  type EphemerisViewState,
  type TimedChartAction,
} from "@/lib/daemon/client";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import { useThemeStore } from "@/stores/theme-store";
import { useT } from "@/lib/i18n/i18n";

// ---------------------------------------------------------------------------
// Graphic Ephemeris — daemon-owned view-only child (launcherKind "ephemeris").
// The daemon (ephemeris_service via ephemcalc.EphemCalc) ships one sample per
// day for 12 anchored months (longitude + declination, ayanamsha-rebased) plus
// refined station events (SR/SD, DN/DS, EQ). This view only maps days/degrees
// to canvas pixels and draws — nothing astrological is computed here.
// Oracle: graphephemwnd.py drawBkg (plot semantics) + graphephemframe.py
// (context-menu model, stepping, per-radix state).
// ---------------------------------------------------------------------------

export type GraphicEphemerisDisplayMode = "longitude" | "declination";
type DisplayMode = GraphicEphemerisDisplayMode;

const SIGN_NUM = 12;
const DECLINATION_LIMIT = 30.0; // GraphEphemWnd.DECLINATION_LIMIT
const STATION_DEBOUNCE_MS = 180; // GraphEphemWnd.STATION_DEBOUNCE_MS

const BASE_CACHE_LIMIT = 36;
const STATION_CACHE_LIMIT = 36;
const ephemerisBaseCache = new Map<string, EphemerisPayload>();
const ephemerisStationCache = new Map<string, EphemerisStationsPayload>();
const EMPTY_EPHEMERIS_PROFILE_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({});

function useEphemerisDataKey(): string {
  return useDaemonWorkspaceStore(
    (state) => state.lastOptionsChange?.ephemerisDataKey ?? "ephemeris-startup",
  );
}

function positive(value: number, fallback: number): number {
  return value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ephemerisCacheKey(dataKey: string, year: number, month: number): string {
  return `${dataKey}:${year}:${month}`;
}

function rememberBasePayload(key: string, payload: EphemerisPayload): void {
  ephemerisBaseCache.set(key, {
    ...payload,
    stations: { longitude: [], declination: [] },
    signEvents: [],
  });
  if (ephemerisBaseCache.size > BASE_CACHE_LIMIT) {
    const oldest = ephemerisBaseCache.keys().next().value;
    if (oldest) ephemerisBaseCache.delete(oldest);
  }
}

function rememberStations(key: string, payload: EphemerisStationsPayload): void {
  ephemerisStationCache.set(key, payload);
  if (ephemerisStationCache.size > STATION_CACHE_LIMIT) {
    const oldest = ephemerisStationCache.keys().next().value;
    if (oldest) ephemerisStationCache.delete(oldest);
  }
}

function markerPayloadFromFrame(payload: EphemerisPayload): EphemerisStationsPayload {
  return {
    year: payload.year,
    startMonth: payload.startMonth,
    stations: payload.stations,
    signEvents: payload.signEvents ?? [],
  };
}

function frameWithMarkers(
  payload: EphemerisPayload,
  markers: EphemerisStationsPayload,
): EphemerisPayload {
  return {
    ...payload,
    stations: markers.stations,
    signEvents: markers.signEvents ?? [],
  };
}

type Geometry = {
  w: number;
  h: number;
  border: number;
  spaceSize: number;
  signSize: number;
  monthSize: number;
  planetFontPx: number;
  signFontPx: number;
  txtFontPx: number;
  axisLabelWidth: number;
  axisX: number; // vertical axis line x
  xOrig: number; // plot origin (first data day)
  yBottom: number;
  yTop: number;
  plotWidth: number;
  frameW: number;
  curveW: number;
};

/** Transcription of graphephemwnd.drawBkg size derivation
 * (graphephemwnd.py:1048-1063) + _plot_geometry (py:236-241). All divisors stay
 * keyed to tableSize=min(w,h), per the wx proportional model. */
function computeGeometry(
  w: number,
  h: number,
  mode: DisplayMode,
  measure: (txt: string, sizePx: number) => number,
  style: EphemerisRenderStyle,
): Geometry {
  const layout = style.layout;
  const typography = style.typography;
  const strokes = style.strokes;
  const tableSize = Math.min(w, h);
  const planetSymbolSize = tableSize / positive(typography.planetFontDivisor, 40);
  const border = planetSymbolSize * layout.borderPlanetScale;
  const spaceSize = planetSymbolSize / positive(layout.spaceDivisor, 3);
  const signSize =
    (h - layout.bottomAxisBorderScale * border - layout.outerBorderScale * border) /
    positive(SIGN_NUM + layout.signOuterMarginRows, SIGN_NUM + 2);
  const axisReserveSignSize = signSize * layout.axisReserveSignScale;
  const x1 = layout.plotLeftBorderScale * border + axisReserveSignSize + spaceSize;
  const x2 = w - layout.plotRightBorderScale * border;
  const monthSize = (x2 - x1) / positive(layout.monthColumns, 13);
  const txtSymbolSize = Math.min(signSize, monthSize) / positive(typography.textFontDivisor, 3);
  const signSymbolSize = txtSymbolSize * typography.signFontScale;

  // _axis_label_width (py:231-234): declination mode reserves the '+30' label.
  const axisLabelWidth =
    mode === "declination"
      ? Math.max(measure("+30", txtSymbolSize), measure("-30", txtSymbolSize))
      : signSymbolSize;

  const axisX = layout.axisXBorderScale * border + axisLabelWidth + spaceSize;
  const xOrig = axisX + monthSize;
  const yBottom = h - layout.bottomAxisBorderScale * border - signSize;
  const yTop = yBottom - signSize * SIGN_NUM;

  // Frame/curve weights (py:1100-1104, 1161-1163).
  const frameW =
    tableSize <= strokes.frameSmallMax
      ? strokes.frameWidthSmall
      : tableSize <= strokes.frameMediumMax
        ? strokes.frameWidthMedium
        : strokes.frameWidthLarge;
  const curveW = tableSize <= strokes.curveSmallMax ? strokes.curveWidthSmall : strokes.curveWidthLarge;

  return {
    w,
    h,
    border,
    spaceSize,
    signSize,
    monthSize,
    planetFontPx: planetSymbolSize,
    signFontPx: signSymbolSize,
    txtFontPx: txtSymbolSize,
    axisLabelWidth,
    axisX,
    xOrig,
    yBottom,
    yTop,
    plotWidth: monthSize * 12,
    frameW,
    curveW,
  };
}

/** _map_y (graphephemwnd.py:280-285). */
function mapY(geo: Geometry, mode: DisplayMode, value: number): number {
  if (mode === "declination") {
    const pixelsPerRange = geo.signSize * SIGN_NUM;
    return geo.yBottom - (value + DECLINATION_LIMIT) * (pixelsPerRange / (2 * DECLINATION_LIMIT));
  }
  return geo.yBottom - value * ((geo.signSize * SIGN_NUM) / 360);
}

function longitudeGridY(geo: Geometry, boundaryIndex: number): number {
  return geo.yBottom - boundaryIndex * geo.signSize;
}

function longitudeSignLineY(geo: Geometry, signIndex: number): number {
  return longitudeGridY(geo, signIndex);
}

/** _plot_x_for_day_offset (graphephemwnd.py:276-278). */
function plotX(geo: Geometry, dayOffset: number, totalDays: number): number {
  return geo.xOrig + (dayOffset * geo.plotWidth) / Math.max(1, totalDays);
}

/** _longitude_transition (graphephemwnd.py:1016-1019): the 0/360 wrap test in
 * pixel space — a segment jumping between the outer sign bands is a wrap. */
function longitudeWrap(geo: Geometry, prevY: number, y: number): boolean {
  const bottomWrap = geo.yBottom - geo.signSize;
  const topWrap = geo.yTop + geo.signSize;
  return (prevY > bottomWrap && y < topWrap) || (y > bottomWrap && prevY < topWrap);
}

/** util.normalize twin for the hover readout only (pixel -> degrees display). */
function norm360(v: number): number {
  let x = v % 360;
  if (x < 0) x += 360;
  return x;
}

type HoverInfo = {
  date: string;
  /** Morinus sign glyph char (longitude mode). */
  sign: string;
  signName: string;
  degree: number;
  minute: number;
  declination: boolean;
  declSign?: string;
  planetGlyph?: string;
  stationCode?: string;
  jd?: number;
};

type HoverState = { x: number; y: number; info: HoverInfo } | null;
type EphemerisAnchor = { year: number; month: number };
function graphicEphemerisNavigationKey(
  key: string,
): GraphicEphemerisStepKey | null {
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  return null;
}

type SnapTarget = { x: number; y: number; station: EphemerisStation; glyph: string };

/** _longitude_hover_info / _declination_hover_info value formatting
 * (graphephemwnd.py:568-624) — degree/minute split with carry. */
function degMin(value: number): { deg: number; min: number } {
  let deg = Math.trunc(Math.abs(value));
  let min = Math.trunc((Math.abs(value) - deg) * 60);
  if (min === 60) {
    min = 0;
    deg += 1;
  }
  return { deg, min };
}

function drawStationTick(
  draw: CanvasDraw,
  geo: Geometry,
  style: EphemerisRenderStyle,
  x: number,
  y: number,
  color: string,
): void {
  const markers = style.markers;
  const tick = clamp(geo.signSize * markers.stationTickScale, markers.stationTickMin, markers.stationTickMax);
  const y1 = Math.max(geo.yTop, y - tick);
  const y2 = Math.min(geo.yBottom, y + tick);
  if (y2 <= y1) return;
  draw.line([[x, y1], [x, y2]], {
    fill: color,
    width: style.strokes.stationTickLineWidth,
    lineCap: "square",
  });
}

function eventGlyphSize(geo: Geometry, style: EphemerisRenderStyle): number {
  const markers = style.markers;
  return clamp(geo.signFontPx * markers.eventGlyphScale, markers.eventGlyphMin, markers.eventGlyphMax);
}

function render(
  canvas: HTMLCanvasElement,
  payload: EphemerisPayload,
  mode: DisplayMode,
  visible: Record<number, boolean>,
  showGrid: boolean,
  showEventGlyphs: boolean,
  outOfBoundsMarkerLabel: string,
  style: EphemerisRenderStyle,
  cssW: number,
  cssH: number,
): { geo: Geometry; snapTargets: SnapTarget[] } {
  const layout = style.layout;
  const strokes = style.strokes;
  const markers = style.markers;
  const labels = style.labels;
  const draw = new CanvasDraw(canvas);
  draw.setDefaultFont(style.typography.fontUi);
  draw.resize(cssW, cssH);
  const colors = style.palette;
  draw.fillBackground(colors.background);

  const measure = (txt: string, sizePx: number) => draw.textsize(txt, { size: sizePx })[0];
  const geo = computeGeometry(cssW, cssH, mode, measure, style);
  const totalDays = Math.max(1, payload.days);
  const snapTargets: SnapTarget[] = [];
  if (cssW < layout.minCanvasWidth || cssH < layout.minCanvasHeight) return { geo, snapTargets };

  const txtFont = { size: geo.txtFontPx, fill: colors.texts };
  const morinus = (size: number, fill: string) =>
    ({ font: style.typography.fontSymbols, size, fill }) as const;

  // === Axes frame (drawBkg py:1106-1118) ===
  const outerBorder = layout.outerBorderScale * geo.border;
  const bottomAxisY = geo.h - layout.bottomAxisBorderScale * geo.border;
  const gridDash = [strokes.gridDashOn, strokes.gridDashOff];

  draw.line([[geo.axisX, outerBorder], [geo.axisX, geo.h - outerBorder]], {
    fill: colors.frame,
    width: geo.frameW,
  });
  draw.line(
    [[outerBorder, bottomAxisY], [geo.w - outerBorder, bottomAxisY]],
    { fill: colors.frame, width: geo.frameW },
  );

  // === Vertical month grid (dashed, py:1120-1132) ===
  if (showGrid) {
    for (const off of payload.monthOffsets) {
      const x = plotX(geo, off, totalDays);
      draw.line([[x, outerBorder], [x, bottomAxisY]], {
        fill: colors.grid,
        width: strokes.gridLineWidth,
        dash: gridDash,
      });
    }
  }

  // === Horizontal grid (_draw_horizontal_grid py:308-330) ===
  if (mode === "declination") {
    if (!showGrid) {
      const y = mapY(geo, mode, 0);
      draw.line([[geo.axisX, y], [geo.w - outerBorder, y]], {
        fill: colors.grid,
        width: strokes.gridLineWidth,
        dash: gridDash,
      });
    } else {
      for (const decl of [30, 20, 10, 0, -10, -20, -30]) {
        const y = mapY(geo, mode, decl);
        draw.line([[geo.axisX, y], [geo.w - outerBorder, y]], {
          fill: colors.grid,
          width: strokes.gridLineWidth,
        });
      }
    }
  } else if (showGrid) {
    for (let i = 0; i <= SIGN_NUM; i++) {
      const y = longitudeGridY(geo, i);
      draw.line([[geo.axisX, y], [geo.w - outerBorder, y]], {
        fill: colors.grid,
        width: strokes.gridLineWidth,
      });
    }
  }

  // === Curves + wrap markers (py:1137-1252) ===
  const visiblePlanets = payload.planets.filter((p) => visible[p.id]);
  type EdgeLabel = { x: number; glyph: string; color: string };
  const leftLabels: Array<{ y: number; glyph: string; color: string }> = [];
  const topMarks: EdgeLabel[] = [];
  const bottomMarks: EdgeLabel[] = [];

  for (const planet of visiblePlanets) {
    const series = mode === "declination" ? planet.declination : planet.longitude;
    if (!series.length) continue;
    const ctx = draw.ctx;
    ctx.save();
    ctx.strokeStyle = planet.color;
    ctx.lineWidth = geo.curveW;
    ctx.beginPath();
    let prevX = 0;
    let prevY = 0;
    let penUp = true;
    for (let i = 0; i < series.length; i++) {
      const x = plotX(geo, i, totalDays);
      const y = mapY(geo, mode, series[i]);
      if (i === 0) {
        leftLabels.push({ y, glyph: planet.glyph, color: planet.color });
      } else if (mode === "longitude" && longitudeWrap(geo, prevY, y)) {
        // 0/360 wrap: break the polyline and mark the crossing edge with the
        // planet glyph (top = wrapped past Pisces, bottom = past Aries).
        if (prevY > geo.yBottom - geo.signSize && y < geo.yTop + geo.signSize) {
          topMarks.push({ x, glyph: planet.glyph, color: planet.color });
        }
        if (y > geo.yBottom - geo.signSize && prevY < geo.yTop + geo.signSize) {
          bottomMarks.push({ x, glyph: planet.glyph, color: planet.color });
        }
        penUp = true;
      } else if (penUp) {
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        penUp = false;
      } else {
        ctx.lineTo(x, y);
      }
      if (i === 0) penUp = true;
      prevX = x;
      prevY = y;
    }
    ctx.stroke();
    ctx.restore();
  }

  // === Left planet glyph labels, simple vertical push-apart (the wx arrange
  // algorithm is chrome; this is the astrolabe-view label-relax pattern) ===
  const glyphH = geo.planetFontPx;
  const relaxIterations = Math.max(0, Math.round(labels.relaxIterations));
  leftLabels.sort((a, b) => a.y - b.y);
  for (let iter = 0; iter < relaxIterations; iter++) {
    let moved = false;
    for (let i = 1; i < leftLabels.length; i++) {
      const gap = leftLabels[i].y - leftLabels[i - 1].y;
      if (gap < glyphH) {
        const push = (glyphH - gap) / 2;
        leftLabels[i - 1].y -= push;
        leftLabels[i].y += push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const lbl of leftLabels) {
    const x = geo.xOrig - labels.leftPlanetLabelGapSpaces * geo.spaceSize;
    draw.text([x, lbl.y], lbl.glyph, {
      ...morinus(geo.planetFontPx, lbl.color),
      align: "right",
      baseline: "middle",
    });
  }

  // Top/bottom wrap glyphs (py:1296-1328) — horizontal push-apart.
  const relaxX = (marks: EdgeLabel[]) => {
    marks.sort((a, b) => a.x - b.x);
    const wGlyph = geo.planetFontPx;
    for (let iter = 0; iter < relaxIterations; iter++) {
      let moved = false;
      for (let i = 1; i < marks.length; i++) {
        const gap = marks[i].x - marks[i - 1].x;
        if (gap < wGlyph) {
          const push = (wGlyph - gap) / 2;
          marks[i - 1].x -= push;
          marks[i].x += push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  };
  relaxX(topMarks);
  relaxX(bottomMarks);
  for (const m of topMarks) {
    draw.text([m.x, geo.yTop - labels.edgeWrapLabelGapSpaces * geo.spaceSize], m.glyph, {
      ...morinus(geo.planetFontPx, m.color),
      align: "center",
      baseline: "bottom",
    });
  }
  for (const m of bottomMarks) {
    draw.text([m.x, geo.yBottom + labels.edgeWrapLabelGapSpaces * geo.spaceSize], m.glyph, {
      ...morinus(geo.planetFontPx, m.color),
      align: "center",
      baseline: "top",
    });
  }

  // === Axis labels (py:287-301) ===
  if (mode === "declination") {
    for (const decl of [30, 20, 10, 0, -10, -20, -30]) {
      const y = mapY(geo, mode, decl);
      draw.text([geo.border, y], `${decl >= 0 ? "+" : ""}${decl}`, {
        ...txtFont,
        align: "left",
        baseline: "middle",
      });
    }
  } else {
    for (let i = 0; i < SIGN_NUM; i++) {
      const y = longitudeSignLineY(geo, i);
      draw.text([layout.axisSignXBorderScale * geo.border, y], payload.signGlyphs[i], {
        ...morinus(geo.signFontPx, colors.signs),
        align: "left",
        baseline: "middle",
      });
    }
  }

  // === Year + month labels (py:1263-1283) ===
  const labelY = bottomAxisY + labels.labelYGapSpaces * geo.spaceSize;
  draw.text([geo.axisX + geo.monthSize / 2, labelY], String(payload.year), {
    ...txtFont,
    align: "center",
    baseline: "top",
  });
  for (let i = 0; i < 12; i++) {
    const left = plotX(geo, payload.monthOffsets[i], totalDays);
    const right = plotX(geo, payload.monthOffsets[i + 1], totalDays);
    draw.text([(left + right) / 2, labelY], payload.monthLabels[i] ?? "", {
      ...txtFont,
      align: "center",
      baseline: "top",
    });
  }

  // === Optional event glyphs (context toggle): exact station codes plus
  // ingress/outgress sign glyphs, both daemon-provided. ===
  const glyphById = new Map(payload.planets.map((p) => [p.id, p.glyph]));
  const colorById = new Map(payload.planets.map((p) => [p.id, p.color]));
  if (showEventGlyphs && mode === "longitude") {
    const size = eventGlyphSize(geo, style);
    for (const ev of payload.signEvents ?? []) {
      if (!visible[ev.planet]) continue;
      const x = plotX(geo, ev.dayOffset, totalDays);
      const y = mapY(geo, mode, ev.value);
      const glyph = payload.signGlyphs[((ev.eventSign % SIGN_NUM) + SIGN_NUM) % SIGN_NUM] ?? "";
      if (!glyph) continue;
      draw.text([x, y], glyph, {
        ...morinus(size, colorById.get(ev.planet) ?? colors.signs),
        align: "center",
        baseline: "middle",
      });
    }
  }

  // === Station snap targets (pixel-space, _build_station_snap_targets) ===
  const stations = mode === "declination" ? payload.stations.declination : payload.stations.longitude;
  for (const st of stations) {
    if (!visible[st.planet]) continue;
    const x = plotX(geo, st.dayOffset, totalDays);
    const y = mapY(geo, mode, st.value);
    const color = colorById.get(st.planet) ?? colors.frame;
    if (st.code !== "EQ") {
      drawStationTick(draw, geo, style, x, y, color);
    }
    if (showEventGlyphs && mode === "longitude" && (st.code === "SR" || st.code === "SD")) {
      draw.text([
        x + Math.max(markers.eventCodeOffsetXMin, geo.spaceSize),
        y - Math.max(markers.eventCodeOffsetYMin, geo.spaceSize),
      ], st.code, {
        size: eventGlyphSize(geo, style),
        fill: color,
        align: "left",
        baseline: "bottom",
      });
    }
    snapTargets.push({
      x,
      y,
      station: st,
      glyph: glyphById.get(st.planet) ?? "",
    });
  }

  // One red OOB label marks the furthest point of every daemon-resolved
  // excursion. The coloured curve already supplies the planet identity.
  // Paint last so the state marker stays legible.
  if (mode === "declination") {
    for (const marker of payload.outOfBounds ?? []) {
      if (!visible[marker.planet]) continue;
      const x = plotX(geo, marker.dayOffset, totalDays);
      const y = mapY(geo, mode, marker.value);
      const north = marker.value >= 0;
      const labelGap = Math.max(markers.eventCodeOffsetYMin, geo.spaceSize);
      draw.text(
        [x, y + (north ? -labelGap : labelGap)],
        outOfBoundsMarkerLabel,
        {
          font: style.typography.fontUi,
          size: eventGlyphSize(geo, style),
          fill: colors.outOfBounds,
          align: "center",
          baseline: north ? "bottom" : "top",
        },
      );
    }
  }

  return { geo, snapTargets };
}

export function GraphEphemerisView({
  documentId,
  registerDisplayModeToggle,
  onDisplayModeChange,
}: {
  documentId: string;
  registerDisplayModeToggle?: (toggle: () => void) => () => void;
  onDisplayModeChange?: (mode: GraphicEphemerisDisplayMode) => void;
}) {
  const t = useT();
  const outOfBoundsMarkerLabel = t("ephem.outOfBoundsMarker");
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [fontsReadyFor, setFontsReadyFor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const applyTimedChartOpenResult = useWorkspaceStore((s) => s.applyTimedChartOpenResult);
  const showRadix = useWorkspaceStore((s) => s.timedChartShowRadix);

  // Anchor + view options. Seeded from the daemon per-radix state store
  // (morin.ephemeris_state_for_radix twin); null until the seed resolves so we
  // never fetch the wrong year first.
  const [anchor, setAnchor] = React.useState<EphemerisAnchor | null>(null);
  const anchorRef = React.useRef<EphemerisAnchor | null>(null);
  const initialAnchorRef = React.useRef<EphemerisAnchor | null>(null);
  const requestSeqRef = React.useRef(0);
  const heldNavigationKeysRef = React.useRef(
    new Set<GraphicEphemerisStepKey>(),
  );
  const pendingAnchorPersistenceRef = React.useRef<EphemerisAnchor | null>(null);
  const deferredNavigationTailRef = React.useRef<(() => void) | null>(null);
  const navigationPressRef = React.useRef<
    (key: GraphicEphemerisNavigationKey) => void
  >(() => {});
  const navigationReleaseRef = React.useRef<
    (key: GraphicEphemerisStepKey | null) => void
  >(() => {});
  const navigationCancelRef = React.useRef<() => void>(() => {});
  const [mode, setMode] = React.useState<DisplayMode>("longitude");
  const modeRef = React.useRef<DisplayMode>("longitude");
  const [showGrid, setShowGrid] = React.useState(true);
  const [showEventGlyphs, setShowEventGlyphs] = React.useState(false);
  const [visible, setVisible] = React.useState<Record<number, boolean>>({});
  const requiresEventMarkers = showEventGlyphs && mode === "longitude";

  const [payload, setPayload] = React.useState<EphemerisPayload | null>(null);
  const theme = useThemeStore((s) => s.theme);
  const styleRevision = useStyleRevision();
  const ephemerisDataKey = useEphemerisDataKey();
  const chartTextFont = morinusTextFontFromTokens(theme?.appTokens);
  const chartSymbolFont =
    theme?.appTokens?.["--aries-font-symbols"]?.trim() || '"AriesMorinus"';
  const chartFontKey = `${chartTextFont}\u0000${chartSymbolFont}`;
  const fontsReady = fontsReadyFor === chartFontKey;
  const chartProfileOverrides =
    theme?.profileOverrides.chartPalette ?? EMPTY_EPHEMERIS_PROFILE_OVERRIDES;
  const ephemerisPaletteOverrides = React.useMemo(() => {
    const outOfBounds = theme?.appTokens?.["--aries-destructive"]?.trim();
    return outOfBounds
      ? { ...chartProfileOverrides, "--aries-destructive": outOfBounds }
      : chartProfileOverrides;
  }, [chartProfileOverrides, theme?.appTokens]);
  const profilePlanetColors = theme?.profileOverrides.chartData.planets;
  const effectivePalette = React.useMemo(
    () => resolveEphemerisRenderPalette(
      payload?.colors ?? DEFAULT_EPHEMERIS_RENDER_PALETTE,
      ephemerisPaletteOverrides,
    ),
    [ephemerisPaletteOverrides, payload?.colors],
  );
  const effectivePayload = React.useMemo<EphemerisPayload | null>(() => {
    if (!payload) return null;
    const planets = applyEphemerisPlanetProfileColors(payload.planets, profilePlanetColors);
    return planets === payload.planets ? payload : { ...payload, planets: [...planets] };
  }, [payload, profilePlanetColors]);

  // Hover state — DOM overlay tooltip (the wx hover flag), station-snapped.
  const [hover, setHover] = React.useState<HoverState>(null);
  const hoverRafRef = React.useRef<number | null>(null);
  const pendingHoverRef = React.useRef<HoverState>(null);
  // Right-click event moment for the timed-chart actions (greenwich jd; the
  // daemon converts to radix-local, workspace_service._timed_chart_when_iso).
  const [menuEventJd, setMenuEventJd] = React.useState<number | null>(null);

  // Render outputs needed by hit-testing (geometry + snap targets).
  const geoRef = React.useRef<Geometry | null>(null);
  const snapRef = React.useRef<SnapTarget[]>([]);
  const renderStyleRef = React.useRef<EphemerisRenderStyle | null>(null);

  React.useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const setHoverCoalesced = React.useCallback((next: HoverState) => {
    pendingHoverRef.current = next;
    if (hoverRafRef.current != null) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      setHover(pendingHoverRef.current);
    });
  }, []);

  React.useEffect(
    () => () => {
      if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current);
    },
    [],
  );

  const clearInteraction = React.useCallback(() => {
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    pendingHoverRef.current = null;
    geoRef.current = null;
    snapRef.current = [];
    renderStyleRef.current = null;
    setHover(null);
    setMenuEventJd(null);
  }, []);

  const applyPayload = React.useCallback(
    (nextPayload: EphemerisPayload) => {
      clearInteraction();
      setPayload({
        ...nextPayload,
        outOfBounds: nextPayload.outOfBounds ?? [],
        signEvents: nextPayload.signEvents ?? [],
      });
      setVisible((current) => {
        const next: Record<number, boolean> = {};
        const availableIds = new Set(nextPayload.planets.map((planet) => String(planet.id)));
        let changed = Object.keys(current).some((id) => !availableIds.has(id));
        for (const planet of nextPayload.planets) {
          if (Object.prototype.hasOwnProperty.call(current, planet.id)) {
            next[planet.id] = Boolean(current[planet.id]);
          } else {
            next[planet.id] = planet.defaultVisible[modeRef.current];
            changed = true;
          }
        }
        return changed ? next : current;
      });
      onDisplayModeChange?.(modeRef.current);
    },
    [clearInteraction, onDisplayModeChange],
  );

  const applyMarkers = React.useCallback((target: EphemerisAnchor, markerPayload: EphemerisStationsPayload) => {
    setPayload((current) => {
      if (!current || current.year !== target.year || current.startMonth !== target.month) {
        return current;
      }
      return {
        ...current,
        stations: markerPayload.stations,
        signEvents: markerPayload.signEvents ?? [],
      };
    });
  }, []);

  const storeViewState = React.useCallback(
    (next: Partial<EphemerisViewState>) => {
      const currentAnchor = anchorRef.current;
      const state: EphemerisViewState = {
        year: currentAnchor?.year,
        start_month: currentAnchor?.month,
        show_grid: showGrid,
        show_event_glyphs: showEventGlyphs,
        display_mode: mode,
        visible_planets: Object.fromEntries(
          Object.entries(visible).map(([k, v]) => [k, Boolean(v)]),
        ),
        ...next,
      };
      void storeEphemerisViewState(documentId, state).catch((err) =>
        console.error("[ephemeris-state-store]", err),
      );
    },
    [documentId, mode, showEventGlyphs, showGrid, visible],
  );

  const commitAnchor = React.useCallback(
    (next: EphemerisAnchor, options?: { persist?: boolean }) => {
      anchorRef.current = next;
      requestSeqRef.current += 1;
      clearInteraction();
      setError(null);
      setAnchor(next);
      if (options?.persist !== false) {
        if (heldNavigationKeysRef.current.size > 0) {
          pendingAnchorPersistenceRef.current = next;
        } else {
          storeViewState({ year: next.year, start_month: next.month });
        }
      }
    },
    [clearInteraction, storeViewState],
  );

  React.useEffect(() => {
    let cancelled = false;
    void awaitFonts(chartTextFont, chartSymbolFont).then(() => {
      if (!cancelled) setFontsReadyFor(chartFontKey);
    });
    return () => {
      cancelled = true;
    };
  }, [chartFontKey, chartSymbolFont, chartTextFont]);

  // --- Seed from the daemon per-radix view state (graphephemframe.apply_state)
  React.useEffect(() => {
    let cancelled = false;
    void fetchEphemerisViewState(documentId)
      .then((state: EphemerisViewState) => {
        if (cancelled) return;
        const seededMode =
          state.display_mode === "declination" || state.display_mode === "longitude"
            ? state.display_mode
            : "longitude";
        modeRef.current = seededMode;
        setMode(seededMode);
        if (typeof state.show_grid === "boolean") setShowGrid(state.show_grid);
        if (typeof state.show_event_glyphs === "boolean") setShowEventGlyphs(state.show_event_glyphs);
        if (state.visible_planets && Object.keys(state.visible_planets).length > 0) {
          const seeded: Record<number, boolean> = {};
          for (const [k, v] of Object.entries(state.visible_planets)) {
            seeded[Number(k)] = Boolean(v);
          }
          setVisible(seeded);
        }
        // wx _workspace_table_ephemeris: saved state year, else current year.
        const seededAnchor = {
          year: state.year ?? new Date().getFullYear(),
          month: state.start_month ?? 1,
        };
        initialAnchorRef.current = { ...seededAnchor };
        anchorRef.current = seededAnchor;
        requestSeqRef.current += 1;
        setAnchor(seededAnchor);
      })
      .catch((err) => {
        console.error("[ephemeris-state]", err);
        if (!cancelled) {
          modeRef.current = "longitude";
          setMode("longitude");
          const fallbackAnchor = { year: new Date().getFullYear(), month: 1 };
          initialAnchorRef.current = { ...fallbackAnchor };
          anchorRef.current = fallbackAnchor;
          requestSeqRef.current += 1;
          setAnchor(fallbackAnchor);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const anchorYear = anchor?.year ?? null;
  const anchorMonth = anchor?.month ?? null;

  // --- Series fetch. The daemon caches the expensive daily series; the frontend
  // keeps a guarded cache of drawable base payloads so held-arrow repeat can swap
  // warmed anchors immediately. Stale requests are cancelled/ignored by sequence,
  // so repeated stepping keeps advancing the intended anchor while the old plot
  // stays visible. Exact event markers are part of the coherent frame whenever
  // their visible glyph layer is enabled. Otherwise hover-only station data stays
  // behind the wx debounce interval and never blocks the visible plot.
  React.useEffect(() => {
    if (anchorYear == null || anchorMonth == null) return;
    let cancelled = false;
    const controller = new AbortController();
    let warmTimer: number | null = null;
    let stationTimer: number | null = null;
    const seq = ++requestSeqRef.current;
    const target = { year: anchorYear, month: anchorMonth };
    const cacheKey = ephemerisCacheKey(ephemerisDataKey, target.year, target.month);

    const warmBasePayloads = () => {
      const warm: Array<[number, number]> = [
        target.month === 1 ? [target.year - 1, 12] : [target.year, target.month - 1],
        target.month === 12 ? [target.year + 1, 1] : [target.year, target.month + 1],
        [target.year - 1, target.month],
        [target.year + 1, target.month],
        target.month <= 2 ? [target.year - 1, target.month + 10] : [target.year, target.month - 2],
        target.month >= 11 ? [target.year + 1, target.month - 10] : [target.year, target.month + 2],
      ];
      warmTimer = window.setTimeout(() => {
        void (async () => {
          for (const [y, m] of warm) {
            if (cancelled || requestSeqRef.current !== seq) return;
            const warmKey = ephemerisCacheKey(ephemerisDataKey, y, m);
            const cachedBase = ephemerisBaseCache.get(warmKey);
            const cachedMarkers = ephemerisStationCache.get(warmKey);
            if (cachedBase && (!requiresEventMarkers || cachedMarkers)) continue;
            try {
              if (cachedBase) {
                const warmMarkers = await fetchGraphicEphemerisStations(
                  y,
                  m,
                  controller.signal,
                );
                rememberStations(warmKey, warmMarkers);
              } else {
                const warmPayload = await fetchGraphicEphemeris(y, m, {
                  signal: controller.signal,
                  includeStations: requiresEventMarkers,
                });
                rememberBasePayload(warmKey, warmPayload);
                if (requiresEventMarkers) {
                  rememberStations(warmKey, markerPayloadFromFrame(warmPayload));
                }
              }
            } catch {
              // Warm-cache misses are non-blocking; the active anchor stays visible.
            }
            await new Promise((resolve) => window.setTimeout(resolve, 40));
          }
        })();
      }, 80);
    };

    const fetchStations = () => {
      stationTimer = window.setTimeout(() => {
        if (cancelled || requestSeqRef.current !== seq) return;
        const cachedStations = ephemerisStationCache.get(cacheKey);
        if (cachedStations) {
          applyMarkers(target, cachedStations);
          return;
        }
        void fetchGraphicEphemerisStations(target.year, target.month, controller.signal)
          .then((stationPayload) => {
            if (cancelled || requestSeqRef.current !== seq) return;
            rememberStations(cacheKey, stationPayload);
            applyMarkers(target, stationPayload);
          })
          .catch((err) => {
            if (err instanceof DOMException && err.name === "AbortError") return;
            console.error("[ephemeris-stations]", err);
          });
      }, STATION_DEBOUNCE_MS);
    };

    // Hover-only station refinement (when event glyphs are hidden) and
    // speculative cache warming are completion work, not part of the next
    // coherent plot. Hold one latest tail behind the explicit arrow-key envelope
    // so neither can start between native key repeats.
    const runPostPaintTail = () => {
      if (!ephemerisStationCache.has(cacheKey)) fetchStations();
      warmBasePayloads();
    };
    const schedulePostPaintTail = () => {
      if (heldNavigationKeysRef.current.size > 0) {
        deferredNavigationTailRef.current = runPostPaintTail;
        return;
      }
      runPostPaintTail();
    };
    const cleanup = () => {
      cancelled = true;
      controller.abort();
      if (deferredNavigationTailRef.current === runPostPaintTail) {
        deferredNavigationTailRef.current = null;
      }
      if (warmTimer != null) window.clearTimeout(warmTimer);
      if (stationTimer != null) window.clearTimeout(stationTimer);
    };

    const cached = ephemerisBaseCache.get(cacheKey);
    const cachedMarkers = ephemerisStationCache.get(cacheKey);
    if (cached && (!requiresEventMarkers || cachedMarkers)) {
      const cachedFrame = cachedMarkers
        ? frameWithMarkers(cached, cachedMarkers)
        : cached;
      queueMicrotask(() => {
        if (cancelled || requestSeqRef.current !== seq) return;
        applyPayload(cachedFrame);
        setError(null);
        schedulePostPaintTail();
      });
      return cleanup;
    }

    if (cached) {
      void fetchGraphicEphemerisStations(target.year, target.month, controller.signal)
        .then((markerPayload) => {
          if (cancelled || requestSeqRef.current !== seq) return;
          rememberStations(cacheKey, markerPayload);
          applyPayload(frameWithMarkers(cached, markerPayload));
          setError(null);
          schedulePostPaintTail();
        })
        .catch((err) => {
          if (
            cancelled ||
            requestSeqRef.current !== seq ||
            (err instanceof DOMException && err.name === "AbortError")
          ) {
            return;
          }
          console.error("[ephemeris]", err);
          setError(String((err as Error).message ?? err));
        });
      return cleanup;
    }

    void fetchGraphicEphemeris(target.year, target.month, {
      signal: controller.signal,
      includeStations: requiresEventMarkers,
    })
      .then((p) => {
        if (cancelled || requestSeqRef.current !== seq) return;
        rememberBasePayload(cacheKey, p);
        if (requiresEventMarkers) {
          rememberStations(cacheKey, markerPayloadFromFrame(p));
        }
        applyPayload(p);
        setError(null);
        schedulePostPaintTail();
      })
      .catch((err) => {
        if (
          cancelled ||
          requestSeqRef.current !== seq ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        console.error("[ephemeris]", err);
        setError(String((err as Error).message ?? err));
      });
    return cleanup;
  }, [
    anchorYear,
    anchorMonth,
    applyMarkers,
    applyPayload,
    ephemerisDataKey,
    requiresEventMarkers,
  ]);

  // --- Paint (rAF-coalesced) on payload / size / option changes.
  const paintRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !effectivePayload || !fontsReady) return;
    const paint = () => {
      paintRef.current = null;
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const renderStyle = resolveEphemerisRenderStyle(wrap, {
        revision: styleRevision,
        palette: effectivePalette,
        fontUi: chartTextFont,
        fontSymbols: chartSymbolFont,
        profileOverrides: chartProfileOverrides,
      });
      const { geo, snapTargets } = render(
        canvas,
        effectivePayload,
        mode,
        visible,
        showGrid,
        showEventGlyphs,
        outOfBoundsMarkerLabel,
        renderStyle,
        rect.width,
        rect.height,
      );
      geoRef.current = geo;
      snapRef.current = snapTargets;
      renderStyleRef.current = renderStyle;
    };
    const schedule = () => {
      if (paintRef.current != null) return;
      paintRef.current = requestAnimationFrame(paint);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      const pendingPaint = paintRef.current;
      if (pendingPaint != null) {
        cancelAnimationFrame(pendingPaint);
        if (paintRef.current === pendingPaint) paintRef.current = null;
      }
    };
  }, [
    chartProfileOverrides,
    chartSymbolFont,
    chartTextFont,
    effectivePalette,
    effectivePayload,
    fontsReady,
    mode,
    outOfBoundsMarkerLabel,
    visible,
    showEventGlyphs,
    showGrid,
    styleRevision,
  ]);

  React.useEffect(() => {
    if (!effectivePayload || !canvasRef.current) return;
    return registerChartExportRenderer(documentId, (request) => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("visible ephemeris renderer unavailable");
      return renderCanvasChartExport(canvas, request);
    });
  }, [documentId, effectivePayload]);

  // --- Stepping (graphephemframe.step_year/step_month via util.incrMonth).
  const stepYear = React.useCallback(
    (delta: number) => {
      const current = anchorRef.current;
      if (!current) return;
      const next = { year: current.year + delta, month: current.month };
      commitAnchor(next);
    },
    [commitAnchor],
  );
  const stepMonth = React.useCallback(
    (delta: number) => {
      const current = anchorRef.current;
      if (!current) return;
      let { year, month } = current;
      month += delta;
      while (month > 12) {
        month -= 12;
        year += 1;
      }
      while (month < 1) {
        month += 12;
        year -= 1;
      }
      const next = { year, month };
      commitAnchor(next);
    },
    [commitAnchor],
  );

  const resetToInitialAnchor = React.useCallback(() => {
    const initial = initialAnchorRef.current;
    if (!initial) return;

    // Space is a barrier for an in-progress arrow burst. A pending stepped
    // anchor must never persist after the reset, and its deferred cache/station
    // tail must not compete with the reset frame.
    heldNavigationKeysRef.current.clear();
    pendingAnchorPersistenceRef.current = null;
    deferredNavigationTailRef.current = null;

    const current = anchorRef.current;
    if (current?.year === initial.year && current.month === initial.month) {
      storeViewState({ year: initial.year, start_month: initial.month });
      return;
    }
    commitAnchor({ ...initial });
  }, [commitAnchor, storeViewState]);

  const pressNavigationKey = React.useCallback(
    (key: GraphicEphemerisNavigationKey) => {
      if (!anchorRef.current) return;
      if (key === "space") {
        resetToInitialAnchor();
        return;
      }
      heldNavigationKeysRef.current.add(key);
      if (key === "up") stepYear(1);
      else if (key === "down") stepYear(-1);
      else if (key === "left") stepMonth(-1);
      else stepMonth(1);
    },
    [resetToInitialAnchor, stepMonth, stepYear],
  );

  const releaseNavigationKey = React.useCallback(
    (key: GraphicEphemerisStepKey | null) => {
      if (key == null) heldNavigationKeysRef.current.clear();
      else heldNavigationKeysRef.current.delete(key);
      if (heldNavigationKeysRef.current.size > 0) return;

      const pendingAnchor = pendingAnchorPersistenceRef.current;
      pendingAnchorPersistenceRef.current = null;
      if (pendingAnchor) {
        storeViewState({
          year: pendingAnchor.year,
          start_month: pendingAnchor.month,
        });
      }

      const tail = deferredNavigationTailRef.current;
      deferredNavigationTailRef.current = null;
      tail?.();
    },
    [storeViewState],
  );

  const cancelNavigationBurst = React.useCallback(() => {
    heldNavigationKeysRef.current.clear();
    const pendingAnchor = pendingAnchorPersistenceRef.current;
    pendingAnchorPersistenceRef.current = null;
    if (pendingAnchor) {
      storeViewState({
        year: pendingAnchor.year,
        start_month: pendingAnchor.month,
      });
    }
    deferredNavigationTailRef.current = null;
  }, [storeViewState]);

  React.useEffect(() => {
    navigationPressRef.current = pressNavigationKey;
    navigationReleaseRef.current = releaseNavigationKey;
    navigationCancelRef.current = cancelNavigationBurst;
  }, [cancelNavigationBurst, pressNavigationKey, releaseNavigationKey]);

  React.useLayoutEffect(() => {
    return registerGraphicEphemerisNavigator(
      documentId,
      (key) => navigationPressRef.current(key),
      (key) => navigationReleaseRef.current(key),
    );
  }, [documentId]);

  React.useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      const key = graphicEphemerisNavigationKey(event.key);
      if (key) navigationReleaseRef.current(key);
    };
    const closeBurst = () => navigationReleaseRef.current(null);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") closeBurst();
    };
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", closeBurst);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", closeBurst);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      navigationCancelRef.current();
    };
  }, [documentId]);

  // --- Hit-testing: snap to a station target within 10/16 px, else linear
  // day/value readout (graphephemwnd._hover_state_for_point + _hover_info_from_point).
  const hitTest = React.useCallback(
    (px: number, py: number): { info: HoverInfo; x: number; y: number; jd: number | null } | null => {
      const geo = geoRef.current;
      const renderStyle = renderStyleRef.current;
      if (!geo || !renderStyle || !payload || payload.startJd == null) return null;
      let best: SnapTarget | null = null;
      let bestScore = Infinity;
      for (const t of snapRef.current) {
        const dx = Math.abs(px - t.x);
        const dy = Math.abs(py - t.y);
        if (
          dx > renderStyle.interaction.stationSnapX ||
          dy > renderStyle.interaction.stationSnapY
        ) continue;
        const score = dx * dx + dy * dy;
        if (score < bestScore) {
          best = t;
          bestScore = score;
        }
      }
      if (best) {
        const st = best.station;
        if (mode === "declination") {
          const { deg, min } = degMin(st.value);
          return {
            info: {
              date: st.date,
              sign: "",
              signName: "",
              degree: deg,
              minute: min,
              declination: true,
              declSign: st.value >= 0 ? "+" : "-",
              planetGlyph: best.glyph,
              stationCode: st.code,
              jd: st.jd,
            },
            x: best.x,
            y: best.y,
            jd: st.jd,
          };
        }
        const lonValue = norm360(st.value);
        const signIdx = Math.min(11, Math.trunc(lonValue / 30));
        const { deg, min } = degMin(lonValue - signIdx * 30);
        return {
          info: {
            date: st.date,
            sign: payload.signGlyphs[signIdx] ?? "",
            signName: payload.signNames[signIdx] ?? "",
            degree: deg,
            minute: min,
            declination: false,
            planetGlyph: best.glyph,
            stationCode: st.code,
            jd: st.jd,
          },
          x: best.x,
          y: best.y,
          jd: st.jd,
        };
      }
      // Free-cursor readout inside the plot rect.
      const left = geo.xOrig;
      const right = geo.xOrig + geo.plotWidth;
      if (px < left || px > right || py < geo.border || py > geo.yBottom) return null;
      const dayOffset = ((px - left) * payload.days) / Math.max(1, geo.plotWidth);
      const idx = Math.min(payload.days - 1, Math.max(0, Math.trunc(dayOffset)));
      // Month/day label from the daemon month offsets (no Date math on jd).
      let m = 0;
      while (m < 11 && payload.monthOffsets[m + 1] <= idx) m++;
      const dayInMonth = idx - payload.monthOffsets[m] + 1;
      const monthTxt = payload.monthLabels[m] ?? "";
      const date = `${monthTxt.charAt(0).toUpperCase()}${monthTxt.slice(1)} ${dayInMonth}`;
      const jd = payload.startJd + dayOffset;
      if (mode === "declination") {
        const value =
          ((geo.yBottom - py) * (2 * DECLINATION_LIMIT)) / (geo.signSize * SIGN_NUM) -
          DECLINATION_LIMIT;
        const { deg, min } = degMin(value);
        return {
          info: {
            date,
            sign: "",
            signName: "",
            degree: deg,
            minute: min,
            declination: true,
            declSign: value >= 0 ? "+" : "-",
          },
          x: px,
          y: py,
          jd,
        };
      }
      const value = norm360(((geo.yBottom - py) * 360) / (geo.signSize * SIGN_NUM));
      let signIdx = Math.min(11, Math.trunc(value / 30));
      const { deg: rawDeg, min: minute } = degMin(value - signIdx * 30);
      let deg = rawDeg;
      if (deg === 30) {
        deg = 0;
        signIdx = (signIdx + 1) % 12;
      }
      return {
        info: {
          date,
          sign: payload.signGlyphs[signIdx] ?? "",
          signName: payload.signNames[signIdx] ?? "",
          degree: deg,
          minute,
          declination: false,
        },
        x: px,
        y: py,
        jd,
      };
    },
    [mode, payload],
  );

  const onMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      setHoverCoalesced(hit ? { x: hit.x, y: hit.y, info: hit.info } : null);
    },
    [hitTest, setHoverCoalesced],
  );
  const onMouseLeave = React.useCallback(() => setHoverCoalesced(null), [setHoverCoalesced]);

  const onContextCapture = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      setMenuEventJd(hit?.jd ?? null);
    },
    [hitTest],
  );

  const fireTimed = React.useCallback(
    (action: TimedChartAction) => {
      if (menuEventJd == null) return;
      const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
      void openDirectionsTimedChart(documentId, action, "", menuEventJd, null, null, showRadix)
        .then((result) => {
          applyTimedChartOpenResult(result);
        })
        .catch((err) => console.error("[ephemeris-timed-chart]", err))
        .finally(finishSnapshotCommand);
    },
    [applyTimedChartOpenResult, documentId, menuEventJd, showRadix],
  );

  // Mode switch with the wx factory-reset rule (graphephemwnd.set_display_mode):
  // if the visibility set still equals the OLD mode's factory defaults, reset it
  // to the NEW mode's defaults; a customised set is preserved.
  const selectMode = React.useCallback(
    (next: DisplayMode) => {
      if (!payload || next === mode) return;
      const factory = (m: DisplayMode) =>
        Object.fromEntries(payload.planets.map((p) => [p.id, p.defaultVisible[m]]));
      const oldFactory = factory(mode);
      const isFactory = payload.planets.every(
        (p) => Boolean(visible[p.id]) === Boolean(oldFactory[p.id]),
      );
      const nextVisible = isFactory
        ? (factory(next) as Record<number, boolean>)
        : visible;
      modeRef.current = next;
      setMode(next);
      onDisplayModeChange?.(next);
      if (isFactory) setVisible(nextVisible);
      storeViewState({ display_mode: next, visible_planets: nextVisible });
    },
    [mode, onDisplayModeChange, payload, storeViewState, visible],
  );

  React.useLayoutEffect(() => {
    if (!registerDisplayModeToggle) return;
    return registerDisplayModeToggle(() => {
      const next = modeRef.current === "longitude" ? "declination" : "longitude";
      selectMode(next);
    });
  }, [registerDisplayModeToggle, selectMode]);

  const togglePlanet = React.useCallback(
    (planetId: number, checked: boolean) => {
      setVisible((v) => {
        const next = { ...v, [planetId]: checked };
        storeViewState({ visible_planets: next });
        return next;
      });
    },
    [storeViewState],
  );

  const toggleGrid = React.useCallback(
    (checked: boolean) => {
      setShowGrid(checked);
      storeViewState({ show_grid: checked });
    },
    [storeViewState],
  );

  const toggleEventGlyphs = React.useCallback(
    (checked: boolean) => {
      setShowEventGlyphs(checked);
      storeViewState({ show_event_glyphs: checked });
    },
    [storeViewState],
  );

  const selectYear = React.useCallback(
    (year: number) => {
      const current = anchorRef.current;
      if (!current) return;
      commitAnchor({ year, month: current.month });
    },
    [commitAnchor],
  );

  // Save as PNG (graphephemwnd.onSaveAsBitmap — Ephem<year>.png).
  const savePng = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Ephem${payload.year}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }, [payload]);

  const yearChoices = React.useMemo(() => {
    const base = anchor?.year ?? payload?.year ?? new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => base - 5 + i);
  }, [anchor?.year, payload?.year]);

  const timedDisabled = menuEventJd == null;

  return (
    <div
      className="aries-graphic-ephemeris font-morinus-text relative flex h-full w-full min-h-0 flex-1 flex-col bg-background"
      style={payload?.colors?.background ? { backgroundColor: effectivePalette.background } : undefined}
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              ref={wrapRef}
              tabIndex={0}
              onContextMenuCapture={onContextCapture}
              className="relative flex-1 min-h-0 overflow-hidden outline-none"
            >
              <canvas
                ref={canvasRef}
                onMouseMove={onMouseMove}
                onMouseLeave={onMouseLeave}
                onPointerDown={() => wrapRef.current?.focus()}
                className="block h-full w-full"
              />
              {hover ? (
                <HoverFlag
                  hover={hover}
                  colors={effectivePalette}
                />
              ) : null}
              {error ? (
                <div
                  className="absolute inset-0 flex items-center justify-center text-destructive"
                  style={{ fontSize: "var(--aries-ephem-state-font-size)" }}
                >
                  {t("ephem.failed")}: {error}
                </div>
              ) : !payload ? (
                <div
                  className="absolute inset-0 flex items-center justify-center text-muted-foreground"
                  style={{ fontSize: "var(--aries-ephem-state-font-size)" }}
                >
                  {t("ephem.loadingEphemeris")}
                </div>
              ) : null}
            </div>
          }
        />
        <ContextMenuContent className="w-64">
          {/* Timed open actions (graphephemframe.py:57-59,76-82) */}
          <ContextMenuItem disabled={timedDisabled} onClick={() => fireTimed("solar")}>
            {t("ephem.openSolarRevolution")}
          </ContextMenuItem>
          <ContextMenuItem disabled={timedDisabled} onClick={() => fireTimed("transits")}>
            {t("ephem.openAsTransit")}
          </ContextMenuItem>
          <ContextMenuItem disabled={timedDisabled} onClick={() => fireTimed("chart")}>
            {t("ephem.openAsChart")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {/* Mode (Longitude/Declination radio, _build_mode_submenu) */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("ephem.mode")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
              <ContextMenuRadioGroup
                value={mode}
                onValueChange={(v) => selectMode(v as DisplayMode)}
              >
                <ContextMenuRadioItem value="longitude">{t("ephem.longitude")}</ContextMenuRadioItem>
                <ContextMenuRadioItem value="declination">{t("ephem.declination")}</ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {/* Step (_build_step_submenu) */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("ephem.step")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
              <ContextMenuItem onClick={() => stepYear(-1)}>{t("ephem.back1Year")}</ContextMenuItem>
              <ContextMenuItem onClick={() => stepYear(1)}>{t("ephem.forward1Year")}</ContextMenuItem>
              <ContextMenuItem onClick={() => stepMonth(-1)}>{t("ephem.back1Month")}</ContextMenuItem>
              <ContextMenuItem onClick={() => stepMonth(1)}>{t("ephem.forward1Month")}</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {/* Planets toggles (_build_planets_submenu) */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("ephem.planets")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
              {(effectivePayload?.planets ?? []).map((p) => (
                <ContextMenuCheckboxItem
                  key={p.id}
                  checked={Boolean(visible[p.id])}
                  onCheckedChange={(checked) => togglePlanet(p.id, Boolean(checked))}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="font-symbols" style={{ color: p.color }}>{p.glyph}</span>
                    {p.label}
                  </span>
                </ContextMenuCheckboxItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {/* Year ±5 radio (_build_year_submenu) */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t("ephem.year")}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-32">
              <ContextMenuRadioGroup
                value={String(anchor?.year ?? payload?.year ?? "")}
                onValueChange={(v) => selectYear(Number(v))}
              >
                {yearChoices.map((y) => (
                  <ContextMenuRadioItem key={y} value={String(y)}>
                    {y}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuCheckboxItem checked={showGrid} onCheckedChange={(c) => toggleGrid(Boolean(c))}>
            {t("ephem.showGrid")}
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={showEventGlyphs} onCheckedChange={(c) => toggleEventGlyphs(Boolean(c))}>
            {t("ephem.showEventGlyphs")}
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={savePng}>{t("ephem.saveAsImage")}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

/** Hover tooltip — the wx hover flag (graphephemwnd._draw_hover_flag) as a DOM
 * overlay: line 1 = date, line 2 = [planet glyph] [(code)] sign deg°min'. */
function HoverFlag({ hover, colors }: { hover: { x: number; y: number; info: HoverInfo }; colors: EphemerisColors }) {
  const { info } = hover;
  const valueTxt = info.declination
    ? `${info.declSign ?? ""}${info.degree}°${String(info.minute).padStart(2, "0")}'`
    : `${info.degree}°${String(info.minute).padStart(2, "0")}'`;
  return (
    <div
      className="pointer-events-none absolute z-10 border border-border bg-popover text-popover-foreground"
      style={{
        left: `calc(${hover.x}px + var(--aries-ephem-hover-offset-x))`,
        top: `max(var(--aries-ephem-hover-edge-inset), calc(${hover.y}px - var(--aries-ephem-hover-offset-y)))`,
        padding: "var(--aries-ephem-hover-pad-y) var(--aries-ephem-hover-pad-x)",
        fontSize: "var(--aries-ephem-hover-font-size)",
        borderRadius: "var(--aries-ephem-hover-radius)",
        boxShadow: "var(--aries-ephem-hover-shadow)",
        backgroundColor: colors.background,
        borderColor: colors.frame,
        color: colors.texts,
      }}
    >
      <div>{info.date}</div>
      <div className="flex items-center" style={{ gap: "var(--aries-ephem-hover-gap)" }}>
        {info.planetGlyph ? (
          <span className="font-symbols">{info.planetGlyph}</span>
        ) : null}
        {info.stationCode ? <span>({info.stationCode})</span> : null}
        {!info.declination && info.sign ? (
          <span className="font-symbols">{info.sign}</span>
        ) : null}
        <span>{valueTxt}</span>
      </div>
    </div>
  );
}
