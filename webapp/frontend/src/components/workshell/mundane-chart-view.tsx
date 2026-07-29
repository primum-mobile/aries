// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useStyleRevision } from "@/hooks/use-style-revision";
import {
  registerChartExportRenderer,
  renderCanvasChartExport,
} from "@/lib/chart/chart-export-registry";
import { readPalette } from "@/lib/chart/palette";
import {
  DEFAULT_MUNDANE_RENDER_STYLE,
  resolveMundaneAspectPaint,
  resolveMundaneHitMetrics,
  resolveMundaneLayout,
  resolveMundaneOverlayMetrics,
  resolveMundaneRenderStyle,
  resolveMundaneStrokeMetrics,
  resolveMundaneTypographyMetrics,
  type MundaneLayout,
  type MundaneRenderPalette,
  type MundaneRenderStyle,
} from "@/lib/chart/mundane-render-style";
import {
  fetchMundaneChart,
  type InspectorFlagPayload,
  type InspectorFlagRow,
  type InspectorFlagSpan,
  type MundaneChartAspect,
  type MundaneChartBody,
  type MundaneChartData,
  type RGB,
} from "@/lib/daemon/client";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useT } from "@/lib/i18n/i18n";
import {
  createResolvedSemanticChartColorResolver,
  semanticChartColor,
} from "@/lib/theme/semantic-color";
import { useThemeStore } from "@/stores/theme-store";

// Mundane Chart renderer. The wx source is mundanechart.py: drawChart() owns
// the radius table, tick rings, ASC/MC axes, planet-line rings, position labels,
// and arrange/doShift overlap pass. React owns only retained Canvas2D replay.

type FontSet = {
  text: string;
  textSmall: string;
  textBig: string;
  morinus: string;
  morinusAspect: string;
};

type MundaneHoverTarget = {
  key: string;
  payload: InspectorFlagPayload;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
  line?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    tolerance: number;
  };
};

type MundaneFlagAnchor = {
  key: string;
  payload: InspectorFlagPayload;
  x: number;
  y: number;
};

const HOVER_FLAG_SHOW_DELAY_MS = 500;

function z2(n: number): string {
  return String(n).padStart(2, "0");
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function rgbCss(rgb: RGB | null | undefined): string | undefined {
  if (!rgb || rgb.length !== 3) return undefined;
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function rgbaCss(rgb: RGB | null | undefined, alpha: number): string | undefined {
  if (!rgb || rgb.length !== 3) return undefined;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function semanticAlphaColor(
  role: string | null | undefined,
  fallback: RGB | null | undefined,
  alpha: number,
): string | undefined {
  const semantic = semanticChartColor(role, rgbCss(fallback));
  if (!semantic?.startsWith("var(")) return rgbaCss(fallback, alpha);
  return `color-mix(in srgb, ${semantic} ${alpha * 100}%, transparent)`;
}

function readMundanePalette(host: HTMLElement): MundaneRenderPalette {
  const palette = readPalette(host);
  return Object.freeze({
    background: palette.background,
    frame: palette.frame,
    ascmc: palette.angles,
    houses: palette.houses,
    houseNumbers: palette.houseNums,
    positions: palette.positions,
  });
}

function resolveMundanePaintColors(data: MundaneChartData): MundaneChartData {
  const resolveColor = createResolvedSemanticChartColorResolver();
  const resolveBodies = (bodies: MundaneChartBody[]) => bodies.map((body) => ({
    ...body,
    color: resolveColor(body.colorRole, body.color) ?? body.color,
  }));
  return {
    ...data,
    bodies: resolveBodies(data.bodies),
    secondaryBodies: data.secondaryBodies
      ? resolveBodies(data.secondaryBodies)
      : data.secondaryBodies,
    aspects: data.aspects?.map((aspect) => ({
      ...aspect,
      color: resolveColor(aspect.colorRole, aspect.color) ?? aspect.color,
    })),
  };
}

function mundaneXY(layout: MundaneLayout, radius: number, mundane: number): [number, number] {
  return [
    layout.cx + Math.cos(Math.PI + degToRad(-mundane)) * radius,
    layout.cy + Math.sin(Math.PI + degToRad(-mundane)) * radius,
  ];
}

function rawAngleXY(layout: MundaneLayout, radius: number, angleDeg: number): [number, number] {
  return [
    layout.cx + Math.cos(Math.PI + degToRad(angleDeg)) * radius,
    layout.cy + Math.sin(Math.PI + degToRad(angleDeg)) * radius,
  ];
}

function buildFonts(layout: MundaneLayout, style: MundaneRenderStyle): FontSet {
  const metrics = resolveMundaneTypographyMetrics(style, layout);
  return {
    text: `${metrics.text}px ${style.typography.fontUi}`,
    textSmall: `${metrics.smallText}px ${style.typography.fontUi}`,
    textBig: `${metrics.symbol}px ${style.typography.fontUi}`,
    morinus: `${metrics.symbol}px ${style.typography.fontSymbols}`,
    morinusAspect: `${metrics.text}px ${style.typography.fontSymbols}`,
  };
}

function setStroke(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
  style: MundaneRenderStyle,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = style.strokes.lineCap;
  ctx.lineJoin = style.strokes.lineJoin;
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  layout: MundaneLayout,
  radius: number,
  color: string,
  width: number,
  style: MundaneRenderStyle,
) {
  setStroke(ctx, color, width, style);
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRadialLine(
  ctx: CanvasRenderingContext2D,
  layout: MundaneLayout,
  mundane: number,
  r1: number,
  r2: number,
) {
  const [x1, y1] = mundaneXY(layout, r1, mundane);
  const [x2, y2] = mundaneXY(layout, r2, mundane);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  layout: MundaneLayout,
  stepDeg: number,
  r1: number,
  r2: number,
) {
  for (let mundane = 0; mundane < 360; mundane += stepDeg) {
    drawRadialLine(ctx, layout, mundane, r1, r2);
  }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
) {
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

function textSize(ctx: CanvasRenderingContext2D, text: string, font: string): [number, number] {
  ctx.font = font;
  const m = ctx.measureText(text);
  const height = Math.max(1, (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0));
  const fallback = Number.parseFloat(font) || height;
  return [m.width, height || fallback];
}

function bodyTextSize(ctx: CanvasRenderingContext2D, body: MundaneChartBody, fonts: FontSet): [number, number] {
  return textSize(ctx, body.glyph, fonts.morinus);
}

function overlaps(
  x1: number,
  y1: number,
  w1: number,
  h1: number,
  x2: number,
  y2: number,
  w2: number,
  h2: number,
): boolean {
  const xoverlap = (x1 <= x2 && x2 <= x1 + w1) || (x2 <= x1 && x1 <= x2 + w2);
  const yoverlap = (y1 <= y2 && y2 <= y1 + h1) || (y2 <= y1 && y1 <= y2 + h2);
  return xoverlap && yoverlap;
}

function arrangeBodies(
  ctx: CanvasRenderingContext2D,
  data: MundaneChartData,
  layout: MundaneLayout,
  fonts: FontSet,
  bodies: MundaneChartBody[],
  radius: number,
  style: MundaneRenderStyle,
): Map<number, number> {
  const ordered = [...bodies].sort((a, b) => a.mundane - b.mundane);
  const shifts = new Map<number, number>(bodies.map((body) => [body.id, 0]));
  const getShift = (id: number) => shifts.get(id) ?? 0;
  const addShift = (id: number, delta: number) => shifts.set(id, getShift(id) + delta);
  const setShift = (id: number, value: number) => shifts.set(id, value);

  const doShift = (p1: number, p2: number, forward = false): boolean => {
    const b1 = ordered[p1];
    const b2 = ordered[p2];
    if (!b1 || !b2) return false;
    const [w1, h1] = bodyTextSize(ctx, b1, fonts);
    const [w2, h2] = bodyTextSize(ctx, b2, fonts);
    let shifted = false;
    let guard = 0;
    while (guard < style.interaction.collisionMaxIterations) {
      const [x1, y1] = rawAngleXY(layout, radius, data.ascLongitude - b1.mundane - getShift(b1.id));
      const [x2, y2] = rawAngleXY(layout, radius, data.ascLongitude - b2.mundane - getShift(b2.id));
      if (!overlaps(x1, y1, w1, h1, x2, y2, w2, h2)) break;
      if (!forward) addShift(b1.id, -style.interaction.collisionStep);
      addShift(b2.id, style.interaction.collisionStep);
      shifted = true;
      guard += 1;
    }
    return shifted;
  };

  const doArrange = (forward = false) => {
    let shifted = false;
    for (let i = 0; i < ordered.length - 1; i += 1) {
      shifted = doShift(i, i + 1, forward) || shifted;
    }
    if (shifted) doArrange(forward);
  };

  for (let i = 0; i < ordered.length + 1; i += 1) doArrange();

  if (ordered.length > 1) {
    const last = ordered.length - 1;
    const shifted = doShift(last, 0, true);
    if (shifted) {
      for (let i = 0; i < ordered.length; i += 1) doArrange(true);
    } else if (ordered[last].mundane > 300 && ordered[0].mundane < 60) {
      const lon1 = ordered[last].mundane + getShift(ordered[last].id);
      const lon2 = ordered[0].mundane + 360 + getShift(ordered[0].id);
      if (lon1 > lon2) {
        setShift(ordered[0].id, getShift(ordered[0].id) + lon1 - lon2);
        doShift(last, 0, true);
        for (let i = 0; i < ordered.length - 1; i += 1) {
          const a = ordered[i];
          const b = ordered[i + 1];
          const aLon = a.mundane + getShift(a.id);
          const bLon = b.mundane + getShift(b.id);
          if (aLon < 180 && bLon < 180) {
            if (aLon > bLon) {
              setShift(b.id, getShift(b.id) + aLon - bLon);
              doShift(i, i + 1, true);
            } else {
              break;
            }
          } else {
            break;
          }
        }
        for (let i = 0; i < ordered.length; i += 1) doArrange(true);
      }
    }
  }

  return shifts;
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  layout: MundaneLayout,
  mundane: number,
  color: string,
  width: number,
  style: MundaneRenderStyle,
) {
  const ang = Math.PI + degToRad(-mundane);
  const offs = Math.PI / 360;
  const xl = layout.cx + Math.cos(ang + offs) * layout.rASCMC;
  const yl = layout.cy + Math.sin(ang + offs) * layout.rASCMC;
  const xr = layout.cx + Math.cos(ang - offs) * layout.rASCMC;
  const yr = layout.cy + Math.sin(ang - offs) * layout.rASCMC;
  const xm = layout.cx + Math.cos(ang) * layout.rArrow;
  const ym = layout.cy + Math.sin(ang) * layout.rArrow;
  setStroke(ctx, color, width, style);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(xl, yl);
  ctx.lineTo(xr, yr);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(xr, yr);
  ctx.lineTo(xm, ym);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(xm, ym);
  ctx.lineTo(xl, yl);
  ctx.stroke();
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  data: MundaneChartData,
  layout: MundaneLayout,
  style: MundaneRenderStyle,
) {
  const colors = style.palette;
  const strokes = resolveMundaneStrokeMetrics(
    style,
    layout.side,
    data.ascmcSize ?? style.strokes.ascMcConfiguredDefault,
  );
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, layout.side, layout.side);

  if (layout.compound) {
    drawCircle(ctx, layout, layout.r30, colors.frame, strokes.heavy, style);
    drawCircle(ctx, layout, layout.rOuter10, colors.frame, style.strokes.hairline, style);
  }

  drawCircle(ctx, layout, layout.r10, colors.frame, style.strokes.hairline, style);
  drawCircle(ctx, layout, layout.rInner, colors.frame, strokes.heavy, style);
  drawCircle(ctx, layout, layout.rAsp, colors.frame, style.strokes.hairline, style);
  drawCircle(ctx, layout, layout.rBase, colors.ascmc, strokes.ascMc, style);

  setStroke(ctx, colors.frame, strokes.tenDegree, style);
  drawLines(ctx, layout, 10, layout.r0, layout.r10);
  drawLines(ctx, layout, 5, layout.r0, layout.r5);
  setStroke(ctx, colors.frame, style.strokes.hairline, style);
  drawLines(ctx, layout, 1, layout.r0, layout.r1);

  if (layout.compound) {
    setStroke(ctx, colors.frame, strokes.tenDegree, style);
    drawLines(ctx, layout, 10, layout.rOuter0, layout.rOuter10);
    drawLines(ctx, layout, 5, layout.rOuter0, layout.rOuter5);
    setStroke(ctx, colors.frame, style.strokes.hairline, style);
    drawLines(ctx, layout, 1, layout.rOuter0, layout.rOuter1);
  }

  if (data.showHouses) {
    setStroke(ctx, colors.houses, style.strokes.hairline, style);
    data.houses.forEach((house) => drawRadialLine(ctx, layout, house.mundane, layout.rBase, layout.rInner));
    setStroke(ctx, colors.frame, strokes.heavy, style);
    drawLines(ctx, layout, 30, layout.rInner, layout.r30);
  }
}

function drawHouseNames(
  ctx: CanvasRenderingContext2D,
  data: MundaneChartData,
  layout: MundaneLayout,
  fonts: FontSet,
  style: MundaneRenderStyle,
) {
  if (!data.showHouses) return;
  const color = style.palette.houseNumbers;
  data.houses.forEach((house) => {
    const [x, y] = mundaneXY(layout, layout.rHouse, house.nameMundane);
    let xOffset = layout.symbolSize / style.layout.houseLabelOffsetDivisor;
    let yOffset = layout.symbolSize / style.layout.houseLabelOffsetDivisor;
    if (house.house === 1 || house.house === 2) {
      xOffset = 0;
      yOffset = layout.symbolSize / style.layout.houseLabelOffsetDivisor;
      if (house.house === 2) {
        xOffset = layout.symbolSize / style.layout.secondHouseXOffsetDivisor;
      }
    }
    drawText(ctx, house.name, x - xOffset, y - yOffset, fonts.text, color);
  });
}

function drawAscMC(
  ctx: CanvasRenderingContext2D,
  data: MundaneChartData,
  layout: MundaneLayout,
  style: MundaneRenderStyle,
) {
  const colors = style.palette;
  const width = resolveMundaneStrokeMetrics(
    style,
    layout.side,
    data.ascmcSize ?? style.strokes.ascMcConfiguredDefault,
  ).ascMc;
  setStroke(ctx, colors.ascmc, width, style);
  data.angles.forEach((angle) => {
    drawRadialLine(ctx, layout, angle.mundane, layout.rBase, layout.rASCMC);
  });
  data.angles.forEach((angle) => {
    if (angle.arrow) drawArrow(ctx, layout, angle.mundane, colors.ascmc, width, style);
  });
}

function drawMundaneAspects(
  ctx: CanvasRenderingContext2D,
  data: MundaneChartData,
  layout: MundaneLayout,
  fonts: FontSet,
  style: MundaneRenderStyle,
) {
  const aspects = data.aspects ?? [];
  if (aspects.length === 0) return;

  aspects.forEach((aspect) => {
    const fromMundane = aspect.fromMundane ?? aspect.radixMundane ?? 0;
    const toMundane = aspect.toMundane ?? aspect.transitMundane ?? 0;
    const [x1, y1] = mundaneXY(layout, layout.rAsp, fromMundane);
    const [x2, y2] = mundaneXY(layout, layout.rAsp, toMundane);
    const orbRatio = aspect.maxOrbArcmin > 0
      ? Math.min(Math.max(aspect.orbArcmin / aspect.maxOrbArcmin, 0), 1)
      : 0;
    const aspectPaint = resolveMundaneAspectPaint(style, orbRatio, aspect.orbArcmin);
    ctx.save();
    ctx.strokeStyle = aspect.color;
    ctx.lineWidth = aspectPaint.width;
    ctx.globalAlpha = aspectPaint.opacity;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (aspectPaint.dash) ctx.setLineDash([...aspectPaint.dash]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  });

  aspects.forEach((aspect) => {
    drawAspectGlyph(ctx, layout, fonts, aspect);
  });
}

function drawAspectGlyph(
  ctx: CanvasRenderingContext2D,
  layout: MundaneLayout,
  fonts: FontSet,
  aspect: MundaneChartAspect,
) {
  if (!aspect.aspectGlyph) return;
  const fromMundane = aspect.fromMundane ?? aspect.radixMundane ?? 0;
  const toMundane = aspect.toMundane ?? aspect.transitMundane ?? 0;
  const [x1, y1] = mundaneXY(layout, layout.rAsp, fromMundane);
  const [x2, y2] = mundaneXY(layout, layout.rAsp, toMundane);
  const x = (x1 + x2) / 2;
  const y = (y1 + y2) / 2;
  const font = aspect.aspectFont === "morinus" ? fonts.morinusAspect : fonts.text;
  const [w, h] = textSize(ctx, aspect.aspectGlyph, font);
  drawText(ctx, aspect.aspectGlyph, x - w / 2, y - h / 2, font, aspect.color);
}

function drawPlanetLine(
  ctx: CanvasRenderingContext2D,
  layout: MundaneLayout,
  body: MundaneChartBody,
  shift: number,
  r1: number,
  r2: number,
) {
  const [x1, y1] = mundaneXY(layout, r1, body.mundane);
  const [x2, y2] = mundaneXY(layout, r2, body.mundane + shift);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawPlanetLines(
  ctx: CanvasRenderingContext2D,
  layout: MundaneLayout,
  shifts: Map<number, number>,
  bodies: MundaneChartBody[],
  r1: number,
  r2: number,
  style: MundaneRenderStyle,
  r3?: number,
  r4?: number,
) {
  const width = resolveMundaneStrokeMetrics(
    style,
    layout.side,
    style.strokes.ascMcConfiguredDefault,
  ).planetLine;
  setStroke(ctx, style.palette.frame, width, style);
  bodies.forEach((body) => {
    const shift = shifts.get(body.id) ?? 0;
    drawPlanetLine(ctx, layout, body, shift, r1, r2);
    if (r3 != null && r4 != null) {
      drawPlanetLine(ctx, layout, body, shift, r3, r4);
    }
  });
}

function drawPositionLabel(
  ctx: CanvasRenderingContext2D,
  body: MundaneChartBody,
  x: number,
  y: number,
  fonts: FontSet,
  fill: string,
) {
  const deg = String(body.posDeg);
  const min = z2(body.posMin);
  const [wdeg, hdeg] = textSize(ctx, deg, fonts.text);
  const xdeg = x - wdeg / 2;
  const ydeg = y - hdeg / 2;
  drawText(ctx, deg, xdeg, ydeg, fonts.text, fill);
  drawText(ctx, min, xdeg + wdeg, ydeg, fonts.textSmall, fill);
}

function drawPlanets(
  ctx: CanvasRenderingContext2D,
  data: MundaneChartData,
  layout: MundaneLayout,
  fonts: FontSet,
  shifts: Map<number, number>,
  bodies: MundaneChartBody[],
  radius: number,
  retroRadius: number,
  style: MundaneRenderStyle,
  outer = false,
) {
  const colors = style.palette;
  bodies.forEach((body) => {
    const shift = shifts.get(body.id) ?? 0;
    const [x, y] = mundaneXY(layout, radius, body.mundane + shift);
    drawText(
      ctx,
      body.glyph,
      x - layout.symbolSize / style.layout.glyphCenterDivisor,
      y - layout.symbolSize / style.layout.glyphCenterDivisor,
      fonts.morinus,
      body.color,
    );

    if (body.motion) {
      const [rx, ry] = mundaneXY(layout, retroRadius, body.mundane + shift);
      drawText(
        ctx,
        body.motion,
        rx - layout.symbolSize / style.layout.motionCenterDivisor,
        ry - layout.symbolSize / style.layout.motionCenterDivisor,
        fonts.textSmall,
        body.color,
      );
    }

    if (!outer && data.positions) {
      const [px, py] = mundaneXY(layout, layout.rPos, body.mundane + shift);
      drawPositionLabel(ctx, body, px, py, fonts, colors.positions);
    }
  });
}

function collectBodyHoverTargets(
  ctx: CanvasRenderingContext2D,
  layout: MundaneLayout,
  fonts: FontSet,
  shifts: Map<number, number>,
  bodies: MundaneChartBody[],
  radius: number,
  chartRole: "primary" | "outer",
  style: MundaneRenderStyle,
): MundaneHoverTarget[] {
  const pad = resolveMundaneHitMetrics(style, layout.symbolSize).bodyPad;
  const out: MundaneHoverTarget[] = [];
  bodies.forEach((body) => {
    if (!body.hoverFlag) return;
    const shift = shifts.get(body.id) ?? 0;
    const [x, y] = mundaneXY(layout, radius, body.mundane + shift);
    const [w, h] = bodyTextSize(ctx, body, fonts);
    const left = x - layout.symbolSize / style.layout.glyphCenterDivisor;
    const top = y - layout.symbolSize / style.layout.glyphCenterDivisor;
    out.push({
      key: `${chartRole}:${body.id}:${body.mundane}:${shift}`,
      payload: body.hoverFlag,
      x,
      y,
      left: left - pad,
      top: top - pad,
      width: Math.max(w, layout.symbolSize) + pad * 2,
      height: Math.max(h, layout.symbolSize) + pad * 2,
    });
  });
  return out;
}

function collectAspectHoverTargets(
  data: MundaneChartData,
  layout: MundaneLayout,
  style: MundaneRenderStyle,
): MundaneHoverTarget[] {
  const aspects = data.aspects ?? [];
  if (aspects.length === 0) return [];
  const tolerance = resolveMundaneHitMetrics(style, layout.symbolSize).aspectTolerance;
  const out: MundaneHoverTarget[] = [];
  aspects.forEach((aspect, index) => {
    if (!aspect.hoverFlag) return;
    const fromMundane = aspect.fromMundane ?? aspect.radixMundane ?? 0;
    const toMundane = aspect.toMundane ?? aspect.transitMundane ?? 0;
    const [x1, y1] = mundaneXY(layout, layout.rAsp, fromMundane);
    const [x2, y2] = mundaneXY(layout, layout.rAsp, toMundane);
    const left = Math.min(x1, x2) - tolerance;
    const top = Math.min(y1, y2) - tolerance;
    const right = Math.max(x1, x2) + tolerance;
    const bottom = Math.max(y1, y2) + tolerance;
    out.push({
      key: `aspect:${index}:${aspect.scope ?? ""}:${aspect.aspect}:${fromMundane}:${toMundane}`,
      payload: aspect.hoverFlag,
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      left,
      top,
      width: right - left,
      height: bottom - top,
      line: { x1, y1, x2, y2, tolerance },
    });
  });
  return out;
}

function distanceToSegmentSquared(
  x: number,
  y: number,
  line: NonNullable<MundaneHoverTarget["line"]>,
): number {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return (x - line.x1) ** 2 + (y - line.y1) ** 2;
  const rawT = ((x - line.x1) * dx + (y - line.y1) * dy) / len2;
  const t = Math.max(0, Math.min(1, rawT));
  const px = line.x1 + t * dx;
  const py = line.y1 + t * dy;
  return (x - px) ** 2 + (y - py) ** 2;
}

function findMundaneHoverTarget(
  targets: MundaneHoverTarget[],
  x: number,
  y: number,
): MundaneHoverTarget | null {
  let best: MundaneHoverTarget | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  targets.forEach((target) => {
    if (
      x < target.left ||
      x > target.left + target.width ||
      y < target.top ||
      y > target.top + target.height
    ) {
      return;
    }
    const dist = target.line
      ? distanceToSegmentSquared(x, y, target.line)
      : (x - target.x) ** 2 + (y - target.y) ** 2;
    if (target.line && dist > target.line.tolerance ** 2) {
      return;
    }
    if (dist < bestDist) {
      best = target;
      bestDist = dist;
    }
  });
  return best;
}

function drawMundaneChart(
  canvas: HTMLCanvasElement,
  data: MundaneChartData,
  side: number,
  style: MundaneRenderStyle,
): MundaneHoverTarget[] {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(side * dpr));
  canvas.height = Math.max(1, Math.round(side * dpr));
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const secondaryBodies = data.secondaryBodies ?? [];
  const compound = Boolean(data.compound || secondaryBodies.length > 0);
  const layout = resolveMundaneLayout(style, side, compound, data.showHouses);
  const fonts = buildFonts(layout, style);

  ctx.clearRect(0, 0, side, side);
  drawFrame(ctx, data, layout, style);
  drawHouseNames(ctx, data, layout, fonts, style);
  drawAscMC(ctx, data, layout, style);
  drawMundaneAspects(ctx, data, layout, fonts, style);
  const shifts = arrangeBodies(ctx, data, layout, fonts, data.bodies, layout.rPlanet, style);
  drawPlanetLines(
    ctx,
    layout,
    shifts,
    data.bodies,
    layout.rInner,
    layout.rLLine,
    style,
    layout.rAsp,
    layout.rLLine2,
  );
  const hoverTargets = collectAspectHoverTargets(data, layout, style);
  let secondaryShifts: Map<number, number> | null = null;
  if (compound && secondaryBodies.length > 0) {
    secondaryShifts = arrangeBodies(
      ctx,
      data,
      layout,
      fonts,
      secondaryBodies,
      layout.rOuterPlanet,
      style,
    );
    drawPlanetLines(
      ctx,
      layout,
      secondaryShifts,
      secondaryBodies,
      layout.r30,
      layout.rOuterLine,
      style,
    );
  }
  drawPlanets(ctx, data, layout, fonts, shifts, data.bodies, layout.rPlanet, layout.rRetr, style);
  hoverTargets.push(
    ...collectBodyHoverTargets(
      ctx,
      layout,
      fonts,
      shifts,
      data.bodies,
      layout.rPlanet,
      "primary",
      style,
    ),
  );
  if (compound && secondaryBodies.length > 0 && secondaryShifts) {
    drawPlanets(
      ctx,
      data,
      layout,
      fonts,
      secondaryShifts,
      secondaryBodies,
      layout.rOuterPlanet,
      layout.rOuterRetr,
      style,
      true,
    );
    hoverTargets.push(
      ...collectBodyHoverTargets(
        ctx,
        layout,
        fonts,
        secondaryShifts,
        secondaryBodies,
        layout.rOuterPlanet,
        "outer",
        style,
      ),
    );
  }
  return hoverTargets;
}

export function MundaneChartView({
  documentId,
  parentDocumentId,
  sourceName,
  source,
  refreshKey,
}: {
  documentId: string;
  parentDocumentId: string | null;
  sourceName: string;
  source?: string;
  refreshKey?: string | number | null;
}) {
  const t = useT();
  const styleRevision = useStyleRevision();
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const hoverTargetsRef = React.useRef<MundaneHoverTarget[]>([]);
  const hoveredKeyRef = React.useRef<string | null>(null);
  const [data, setData] = React.useState<MundaneChartData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [side, setSide] = React.useState(600);
  const [flagAnchor, setFlagAnchor] = React.useState<MundaneFlagAnchor | null>(null);
  const [renderStyle, setRenderStyle] = React.useState<MundaneRenderStyle>(
    DEFAULT_MUNDANE_RENDER_STYLE,
  );
  const overlayMetrics = resolveMundaneOverlayMetrics(renderStyle, side);
  const infoFontSize = overlayMetrics.fontSize;
  const edgeInset = overlayMetrics.edgeInset;
  const topEdgeInset = overlayMetrics.topEdgeInset;
  const overlayTextColor = renderStyle.palette.houses;
  const sessionRefreshSeq = useDaemonWorkspaceStore((s) => {
    const change = s.lastSessionChange;
    if (!change) return 0;
    if (change.docId === documentId || change.rebuiltChildIds.includes(documentId)) {
      return change.seq;
    }
    if (parentDocumentId && change.docId === parentDocumentId) {
      return change.seq;
    }
    return 0;
  });
  const pushedSnapshotSeq = useDaemonWorkspaceStore((s) => {
    const stepped = s.steppedSnapshot?.docId === documentId ? s.steppedSnapshot.seq : 0;
    const command = s.commandSnapshot?.docId === documentId ? s.commandSnapshot.seq : 0;
    if (!stepped && !command) return "";
    return `${stepped}:${command}`;
  });

  React.useEffect(() => {
    let cancelled = false;
    fetchMundaneChart(sourceName, { source, documentId })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String((err as Error).message ?? err));
        console.error("[mundane-chart]", err);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, sourceName, source, sessionRefreshSeq, pushedSnapshotSeq, refreshKey]);

  React.useLayoutEffect(() => {
    const host = wrapRef.current;
    if (!host) return;
    const css = getComputedStyle(host);
    const textFontFamily = css.getPropertyValue("--morinus-font-text").trim() || "'FreeSans', ui-sans-serif, system-ui, sans-serif";
    const symbolFontFamily = css.getPropertyValue("--aries-font-symbols").trim() || '"AriesMorinus"';
    setRenderStyle(resolveMundaneRenderStyle(host, {
      revision: styleRevision,
      palette: readMundanePalette(host),
      fontUi: textFontFamily,
      fontSymbols: symbolFontFamily,
    }));
  }, [styleRevision]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const s = Math.max(
        renderStyle.layout.minimumSide,
        Math.floor(Math.min(rect.width, rect.height)),
      );
      setSide(s);
    };
    raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [renderStyle.layout.minimumSide]);

  React.useEffect(() => {
    if (!data || !canvasRef.current) return;
    let cancelled = false;
    const draw = async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      if (cancelled || !canvasRef.current) return;
      hoverTargetsRef.current = drawMundaneChart(
        canvasRef.current,
        resolveMundanePaintColors(data),
        side,
        renderStyle,
      );
    };
    void draw();
    return () => {
      cancelled = true;
    };
  }, [data, side, renderStyle]);

  React.useEffect(() => {
    if (!data || !canvasRef.current) return;
    return registerChartExportRenderer(documentId, (request) => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("visible mundane chart renderer unavailable");
      return renderCanvasChartExport(canvas, request);
    });
  }, [data, documentId]);

  const clearHoverFlag = React.useCallback(() => {
    hoveredKeyRef.current = null;
    setFlagAnchor(null);
  }, []);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || hoverTargetsRef.current.length === 0) {
      clearHoverFlag();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      clearHoverFlag();
      return;
    }
    const scaleX = side > 0 ? side / rect.width : 1;
    const scaleY = side > 0 ? side / rect.height : 1;
    const hit = findMundaneHoverTarget(hoverTargetsRef.current, x * scaleX, y * scaleY);
    if (!hit) {
      clearHoverFlag();
      return;
    }
    if (hoveredKeyRef.current === hit.key) return;
    hoveredKeyRef.current = hit.key;
    setFlagAnchor({
      key: hit.key,
      payload: hit.payload,
      x: event.clientX,
      y: event.clientY,
    });
  }, [clearHoverFlag, side]);

  return (
    <div
      ref={wrapRef}
      className="font-morinus-text relative flex h-full w-full flex-1 min-h-0 items-center justify-center overflow-hidden bg-background"
      style={{ backgroundColor: renderStyle.palette.background }}
      onPointerMove={handlePointerMove}
      onPointerLeave={clearHoverFlag}
    >
      {data ? (
        <>
          <canvas ref={canvasRef} className="block" aria-label={t("mundane.chartAria")} />
          <MundaneHoverFlag anchor={flagAnchor} />
          {data.overlay?.showInformation ? (
            <>
              <MundaneCornerLines
                lines={data.overlay.topLeft}
                color={overlayTextColor}
                fontSize={infoFontSize}
                lineHeight={overlayMetrics.lineHeight}
                style={{ top: topEdgeInset, left: edgeInset, textAlign: "left" }}
              />
              <MundaneCornerLines
                lines={data.overlay.bottomLeft}
                color={overlayTextColor}
                fontSize={infoFontSize}
                lineHeight={overlayMetrics.lineHeight}
                style={{ bottom: edgeInset, left: edgeInset, textAlign: "left" }}
              />
            </>
          ) : null}
          {data.overlay?.showHouseSystem ? (
            <MundaneCornerLines
              lines={data.overlay.houseSystemLines}
              color={overlayTextColor}
              fontSize={infoFontSize}
              lineHeight={overlayMetrics.lineHeight}
              style={{ right: edgeInset, bottom: edgeInset, textAlign: "right" }}
            />
          ) : null}
        </>
      ) : error ? (
        <div className="text-[length:var(--aries-font-size-base)] text-destructive">{t("mundane.failed", { error })}</div>
      ) : (
        <div className="text-[length:var(--aries-font-size-base)] text-muted-foreground">{t("mundane.loading")}</div>
      )}
    </div>
  );
}

function MundaneCornerLines({
  lines,
  color,
  fontSize,
  lineHeight,
  style,
}: {
  lines: string[];
  color: string;
  fontSize: number;
  lineHeight: number;
  style: React.CSSProperties;
}) {
  if (!lines.length || fontSize <= 0) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 select-none font-ui"
      style={{
        ...style,
        color,
        fontSize,
        lineHeight,
      }}
    >
      <div className="flex flex-col">
        {lines.map((line) => (
          <div key={`${line}-${fontSize}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function MundaneHoverFlag({ anchor }: { anchor: MundaneFlagAnchor | null }) {
  const styleRevision = useStyleRevision();
  const appTokens = useThemeStore((state) => state.theme?.appTokens);
  const [visibleAnchor, setVisibleAnchor] = React.useState<MundaneFlagAnchor | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = React.useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 });
  const activeAnchor = anchor && visibleAnchor?.key === anchor.key ? visibleAnchor : null;
  const flagGeometry = React.useMemo(() => {
    const rootStyle =
      typeof document === "undefined"
        ? null
        : window.getComputedStyle(document.documentElement);
    const value = (name: string) => {
      const parsed = Number.parseFloat(
        appTokens?.[name] ?? rootStyle?.getPropertyValue(name) ?? "",
      );
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      viewportMargin: value("--aries-inspector-hover-flag-viewport-margin"),
      anchorGapX: value("--aries-inspector-hover-flag-anchor-gap-x"),
      anchorGapY: value("--aries-inspector-hover-flag-anchor-gap-y"),
      compactMinWidth: value("--aries-inspector-hover-flag-compact-min-width"),
      minWidth: value("--aries-inspector-hover-flag-min-width"),
      compactMinHeight: value("--aries-inspector-hover-flag-compact-min-height"),
      minHeight: value("--aries-inspector-hover-flag-min-height"),
      accentBorderOpacity: value(
        "--aries-inspector-hover-flag-accent-border-opacity",
      ),
    };
  }, [appTokens]);

  React.useEffect(() => {
    if (!anchor) return;
    const delay = activeAnchor ? 0 : HOVER_FLAG_SHOW_DELAY_MS;
    const timer = window.setTimeout(() => setVisibleAnchor(anchor), delay);
    return () => window.clearTimeout(timer);
  }, [activeAnchor, anchor]);

  React.useEffect(() => {
    const updateViewport = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  React.useLayoutEffect(() => {
    if (!activeAnchor || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCardSize({ width: rect.width, height: rect.height });
    }
  }, [activeAnchor, styleRevision]);

  if (!activeAnchor) return null;
  const payload = activeAnchor.payload;
  const title = (payload.title ?? "").trim();
  const glyph = (payload.glyph ?? "").trim();
  const rows = payload.rows ?? [];
  if (!title && rows.length === 0) return null;
  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (!portalTarget) return null;

  const compact = Boolean(payload.compact);
  const viewportWidth = viewportSize.width || (typeof window !== "undefined" ? window.innerWidth : 0);
  const viewportHeight = viewportSize.height || (typeof window !== "undefined" ? window.innerHeight : 0);
  const margin = flagGeometry.viewportMargin;
  const xGap = flagGeometry.anchorGapX;
  const yGap = flagGeometry.anchorGapY;
  const cardWidth = Math.max(
    cardSize.width,
    compact ? flagGeometry.compactMinWidth : flagGeometry.minWidth,
  );
  const cardHeight = Math.max(
    cardSize.height,
    compact ? flagGeometry.compactMinHeight : flagGeometry.minHeight,
  );
  let left = activeAnchor.x + xGap;
  let top = activeAnchor.y - cardHeight - yGap;

  if (viewportWidth > 0 && left + cardWidth + margin > viewportWidth) {
    left = activeAnchor.x - cardWidth - xGap;
  }
  if (left < margin) {
    left = Math.max(margin, viewportWidth > 0 ? viewportWidth - cardWidth - margin : margin);
  }
  if (top < margin) {
    top = activeAnchor.y + yGap;
  }
  if (viewportHeight > 0 && top + cardHeight + margin > viewportHeight) {
    top = Math.max(margin, viewportHeight - cardHeight - margin);
  }

  return createPortal(
    <div className="pointer-events-none fixed" style={{ left, top, zIndex: 2147483647 }}>
      <div
        ref={cardRef}
        data-aries-surface="popover"
        className="rounded-[var(--aries-radius-md)] border bg-background/95"
        style={{
          borderColor:
            semanticAlphaColor(
              payload.accentRole,
              payload.accent,
              flagGeometry.accentBorderOpacity,
            ) ?? "var(--border)",
          paddingInline: compact
            ? "calc(var(--aries-control-padding-x) * 7 / 10)"
            : "calc(var(--aries-control-padding-x) * 9 / 10)",
          paddingBlock: compact
            ? "var(--aries-control-padding-y)"
            : "var(--aries-control-gap)",
          minWidth: compact
            ? undefined
            : "var(--aries-inspector-hover-flag-content-min-width)",
          maxWidth:
            "min(var(--aries-dialog-width-xs), calc(100vw - var(--aries-inspector-hover-flag-viewport-margin) - var(--aries-inspector-hover-flag-viewport-margin)))",
          boxShadow: "var(--aries-inspector-hover-flag-shadow)",
          backdropFilter:
            "blur(var(--aries-inspector-hover-flag-backdrop-blur))",
          WebkitBackdropFilter:
            "blur(var(--aries-inspector-hover-flag-backdrop-blur))",
        }}
      >
        <div
          className="flex items-baseline whitespace-nowrap"
          style={{
            gap: compact
              ? "var(--aries-control-gap-compact)"
              : "var(--aries-inspector-section-gap)",
          }}
        >
          {glyph ? (
            <span
              className="leading-none text-foreground/90"
              style={{
                color: compact
                  ? semanticChartColor(payload.accentRole, rgbCss(payload.accent))
                  : undefined,
                fontFamily: "var(--aries-font-symbols)",
                fontSize: compact
                  ? "var(--aries-font-size-large)"
                  : "var(--aries-font-size-dialog-title)",
              }}
            >
              {glyph}
            </span>
          ) : null}
          <span
            className="font-semibold leading-tight text-foreground/90"
            style={{
              fontSize: compact
                ? "var(--aries-font-size-small)"
                : "var(--aries-font-size-reading)",
            }}
          >
            {title}
          </span>
          {payload.motionGlyph ? (
            <span
              className="shrink-0 leading-none text-foreground/70"
              style={{
                color: semanticChartColor(payload.accentRole, rgbCss(payload.accent)),
                fontFamily:
                  payload.motionUsesSymbolFont
                    ? "var(--aries-font-symbols)"
                    : undefined,
                fontSize: compact
                  ? "var(--aries-font-size-section)"
                  : "var(--aries-font-size-base)",
              }}
              aria-label={payload.motionLabel || undefined}
              title={payload.motionLabel || undefined}
            >
              {payload.motionGlyph}
            </span>
          ) : null}
        </div>
        {rows.length > 0 ? (
          <div
            className="grid items-baseline gap-x-[var(--aries-inspector-section-gap)] gap-y-[var(--aries-inspector-row-gap)]"
            style={{
              gridTemplateColumns: "auto 1fr",
              fontSize: compact
                ? "var(--aries-font-size-section)"
                : "var(--aries-font-size-small)",
              marginTop: compact
                ? "var(--aries-control-gap-compact)"
                : "var(--aries-control-gap)",
            }}
          >
            {rows.map((row, idx) => (
              <MundaneFlagRow key={idx} row={row} />
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    portalTarget,
  );
}

function MundaneFlagRow({ row }: { row: InspectorFlagRow }) {
  const label = String(row[0] ?? "");
  const value = String(row[1] ?? "");
  const colour = row.length >= 3 ? (row[2] as RGB | null) : null;
  const spans = row.length >= 4 ? (row[3] as InspectorFlagSpan[]) : null;
  const colourRole = row.length >= 5 ? (row[4] as string | null) : null;

  return (
    <>
      <span className="whitespace-nowrap leading-tight text-foreground/45">{label}</span>
      {spans && spans.length > 0 ? (
        <span className="whitespace-nowrap leading-tight text-foreground/85">
          {spans.map((span, i) => (
            <span
              key={i}
              style={{
                color: semanticChartColor(span.colourRole, rgbCss(span.colour)),
                fontFamily: span.glyph ? "var(--aries-font-symbols)" : undefined,
              }}
            >
              {span.text}
            </span>
          ))}
        </span>
      ) : (
        <span
          className="whitespace-nowrap leading-tight text-foreground/85"
          style={{ color: semanticChartColor(colourRole, rgbCss(colour)) }}
        >
          {value}
        </span>
      )}
    </>
  );
}
