// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useStyleRevision } from "@/hooks/use-style-revision";
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

type Layout = {
  compound: boolean;
  side: number;
  cx: number;
  cy: number;
  maxradius: number;
  symbolSize: number;
  r30: number;
  rHouse: number;
  rASCMC: number;
  rArrow: number;
  r0: number;
  r1: number;
  r5: number;
  r10: number;
  rInner: number;
  rLLine: number;
  rPlanet: number;
  rAsp: number;
  rLLine2: number;
  rRetr: number;
  rPos: number;
  rBase: number;
  rOuterPlanet: number;
  rOuterLine: number;
  rOuterRetr: number;
  rOuter0: number;
  rOuter1: number;
  rOuter5: number;
  rOuter10: number;
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

const SMALL_SIZE = 400;
const MEDIUM_SIZE = 600;
const HOVER_FLAG_SHOW_DELAY_MS = 500;
const DEFAULT_COLORS = {
  background: "#232428",
  frame: "#dcdcdd",
  ascmc: "#cdcdd1",
  houses: "#8a8b8d",
  houseNumbers: "#8a8b8d",
  positions: "#ffffff",
};

const WX_TITLEBAR_OVERLAY_SAFE_TOP = 14;

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

function mundaneXY(layout: Layout, radius: number, mundane: number): [number, number] {
  return [
    layout.cx + Math.cos(Math.PI + degToRad(-mundane)) * radius,
    layout.cy + Math.sin(Math.PI + degToRad(-mundane)) * radius,
  ];
}

function rawAngleXY(layout: Layout, radius: number, angleDeg: number): [number, number] {
  return [
    layout.cx + Math.cos(Math.PI + degToRad(angleDeg)) * radius,
    layout.cy + Math.sin(Math.PI + degToRad(angleDeg)) * radius,
  ];
}

function heavyFrameWidth(chartSize: number): number {
  if (chartSize <= SMALL_SIZE) return 1;
  if (chartSize <= MEDIUM_SIZE) return 2;
  return 3;
}

function tenDegWidth(chartSize: number): number {
  return chartSize <= MEDIUM_SIZE ? 1 : 2;
}

function planetLineWidth(chartSize: number): number {
  return chartSize <= MEDIUM_SIZE ? 1 : 2;
}

function ascMcWidth(chartSize: number, configured: number): number {
  if (chartSize <= SMALL_SIZE && configured >= 3 && configured <= 5) return 2;
  if (chartSize <= MEDIUM_SIZE && configured >= 4 && configured <= 5) return 3;
  return Math.max(1, configured);
}

function buildLayout(side: number, compound: boolean, showHouses: boolean): Layout {
  const maxradius = side / 2;
  const planetsectorlen = compound ? 0.15 : 0.18;
  const housesectorlen = planetsectorlen;
  const planetoffs = (planetsectorlen / 2) * maxradius;
  const planetlinelen = 0.03;
  const houseoffs = (housesectorlen / 2 - (compound ? 0 : 0.01)) * maxradius;
  const rOuterMax = maxradius * 0.97;
  const r30 = compound
    ? (showHouses ? rOuterMax - 0.06 * maxradius : rOuterMax) - 0.12 * maxradius
    : maxradius * 0.96;
  const r0 = r30 - housesectorlen * maxradius;
  const rHouse = r30 - houseoffs;
  const rASCMC = compound ? rHouse : maxradius * 0.88;
  const rAsp = r0 - planetsectorlen * maxradius;
  const rLLine2 = rAsp + planetlinelen * maxradius;
  const rOuterLine = r30 + planetlinelen * maxradius;
  return {
    compound,
    side,
    cx: side / 2,
    cy: side / 2,
    maxradius,
    symbolSize: Math.max(8, maxradius / (compound ? 16 : 12)),
    r30,
    rHouse,
    rASCMC,
    rArrow: rASCMC + 0.04 * maxradius,
    r0,
    r1: r0 + 0.01 * maxradius,
    r5: r0 + 0.02 * maxradius,
    r10: r0 + 0.03 * maxradius,
    rInner: r0,
    rLLine: r0 - planetlinelen * maxradius,
    rPlanet: r0 - planetoffs,
    rAsp,
    rLLine2,
    rRetr: rLLine2 + maxradius * 0.01,
    rPos: maxradius * (compound ? 0.45 : 0.55),
    rBase: maxradius * (compound ? 0.11 : 0.2),
    rOuterPlanet: r30 + planetoffs,
    rOuterLine,
    rOuterRetr: rOuterLine + maxradius * 0.01,
    rOuter0: r30,
    rOuter1: r30 - 0.01 * maxradius,
    rOuter5: r30 - 0.02 * maxradius,
    rOuter10: r30 - 0.03 * maxradius,
  };
}

function buildFonts(layout: Layout, textFontFamily: string): FontSet {
  const symPx = Math.max(6, Math.round(layout.symbolSize));
  const textPx = Math.max(6, Math.round(symPx / 2));
  const smallTextPx = Math.max(6, Math.round(symPx / 4));
  return {
    text: `${textPx}px ${textFontFamily}`,
    textSmall: `${smallTextPx}px ${textFontFamily}`,
    textBig: `${symPx}px ${textFontFamily}`,
    morinus: `${symPx}px "AriesMorinus"`,
    morinusAspect: `${textPx}px "AriesMorinus"`,
  };
}

function setStroke(ctx: CanvasRenderingContext2D, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}

function drawCircle(ctx: CanvasRenderingContext2D, layout: Layout, radius: number, color: string, width: number) {
  setStroke(ctx, color, width);
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRadialLine(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
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

function drawLines(ctx: CanvasRenderingContext2D, layout: Layout, stepDeg: number, r1: number, r2: number) {
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
  layout: Layout,
  fonts: FontSet,
  bodies: MundaneChartBody[],
  radius: number,
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
    while (guard < 5000) {
      const [x1, y1] = rawAngleXY(layout, radius, data.ascLongitude - b1.mundane - getShift(b1.id));
      const [x2, y2] = rawAngleXY(layout, radius, data.ascLongitude - b2.mundane - getShift(b2.id));
      if (!overlaps(x1, y1, w1, h1, x2, y2, w2, h2)) break;
      if (!forward) addShift(b1.id, -0.1);
      addShift(b2.id, 0.1);
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
  layout: Layout,
  mundane: number,
  color: string,
  width: number,
) {
  const ang = Math.PI + degToRad(-mundane);
  const offs = Math.PI / 360;
  const xl = layout.cx + Math.cos(ang + offs) * layout.rASCMC;
  const yl = layout.cy + Math.sin(ang + offs) * layout.rASCMC;
  const xr = layout.cx + Math.cos(ang - offs) * layout.rASCMC;
  const yr = layout.cy + Math.sin(ang - offs) * layout.rASCMC;
  const xm = layout.cx + Math.cos(ang) * layout.rArrow;
  const ym = layout.cy + Math.sin(ang) * layout.rArrow;
  setStroke(ctx, color, width);
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

function drawFrame(ctx: CanvasRenderingContext2D, data: MundaneChartData, layout: Layout) {
  const colors = data.colors ?? DEFAULT_COLORS;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, layout.side, layout.side);

  if (layout.compound) {
    drawCircle(ctx, layout, layout.r30, colors.frame, heavyFrameWidth(layout.side));
    drawCircle(ctx, layout, layout.rOuter10, colors.frame, 1);
  }

  drawCircle(ctx, layout, layout.r10, colors.frame, 1);
  drawCircle(ctx, layout, layout.rInner, colors.frame, heavyFrameWidth(layout.side));
  drawCircle(ctx, layout, layout.rAsp, colors.frame, 1);
  drawCircle(ctx, layout, layout.rBase, colors.ascmc, ascMcWidth(layout.side, data.ascmcSize ?? 5));

  setStroke(ctx, colors.frame, tenDegWidth(layout.side));
  drawLines(ctx, layout, 10, layout.r0, layout.r10);
  drawLines(ctx, layout, 5, layout.r0, layout.r5);
  setStroke(ctx, colors.frame, 1);
  drawLines(ctx, layout, 1, layout.r0, layout.r1);

  if (layout.compound) {
    setStroke(ctx, colors.frame, tenDegWidth(layout.side));
    drawLines(ctx, layout, 10, layout.rOuter0, layout.rOuter10);
    drawLines(ctx, layout, 5, layout.rOuter0, layout.rOuter5);
    setStroke(ctx, colors.frame, 1);
    drawLines(ctx, layout, 1, layout.rOuter0, layout.rOuter1);
  }

  if (data.showHouses) {
    setStroke(ctx, colors.houses, 1);
    data.houses.forEach((house) => drawRadialLine(ctx, layout, house.mundane, layout.rBase, layout.rInner));
    setStroke(ctx, colors.frame, heavyFrameWidth(layout.side));
    drawLines(ctx, layout, 30, layout.rInner, layout.r30);
  }
}

function drawHouseNames(ctx: CanvasRenderingContext2D, data: MundaneChartData, layout: Layout, fonts: FontSet) {
  if (!data.showHouses) return;
  const color = (data.colors ?? DEFAULT_COLORS).houseNumbers;
  data.houses.forEach((house) => {
    const [x, y] = mundaneXY(layout, layout.rHouse, house.nameMundane);
    let xOffset = layout.symbolSize / 4;
    let yOffset = layout.symbolSize / 4;
    if (house.house === 1 || house.house === 2) {
      xOffset = 0;
      yOffset = layout.symbolSize / 4;
      if (house.house === 2) {
        xOffset = layout.symbolSize / 8;
      }
    }
    drawText(ctx, house.name, x - xOffset, y - yOffset, fonts.text, color);
  });
}

function drawAscMC(ctx: CanvasRenderingContext2D, data: MundaneChartData, layout: Layout) {
  const colors = data.colors ?? DEFAULT_COLORS;
  const width = ascMcWidth(layout.side, data.ascmcSize ?? 5);
  setStroke(ctx, colors.ascmc, width);
  data.angles.forEach((angle) => {
    drawRadialLine(ctx, layout, angle.mundane, layout.rBase, layout.rASCMC);
  });
  data.angles.forEach((angle) => {
    if (angle.arrow) drawArrow(ctx, layout, angle.mundane, colors.ascmc, width);
  });
}

function drawMundaneAspects(
  ctx: CanvasRenderingContext2D,
  data: MundaneChartData,
  layout: Layout,
  fonts: FontSet,
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
    ctx.save();
    ctx.strokeStyle = aspect.color;
    ctx.lineWidth = Math.max(1, Math.round(2 * (1 - orbRatio)));
    ctx.globalAlpha = 0.35 + 0.65 * (1 - orbRatio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (aspect.orbArcmin > 0.25) {
      ctx.setLineDash([6, 6]);
    }
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
  layout: Layout,
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
  layout: Layout,
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
  data: MundaneChartData,
  layout: Layout,
  shifts: Map<number, number>,
  bodies: MundaneChartBody[],
  r1: number,
  r2: number,
  r3?: number,
  r4?: number,
) {
  setStroke(ctx, (data.colors ?? DEFAULT_COLORS).frame, planetLineWidth(layout.side));
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
  layout: Layout,
  fonts: FontSet,
  shifts: Map<number, number>,
  bodies: MundaneChartBody[],
  radius: number,
  retroRadius: number,
  outer = false,
) {
  const colors = data.colors ?? DEFAULT_COLORS;
  bodies.forEach((body) => {
    const shift = shifts.get(body.id) ?? 0;
    const [x, y] = mundaneXY(layout, radius, body.mundane + shift);
    drawText(ctx, body.glyph, x - layout.symbolSize / 2, y - layout.symbolSize / 2, fonts.morinus, body.color);

    if (body.motion) {
      const [rx, ry] = mundaneXY(layout, retroRadius, body.mundane + shift);
      drawText(ctx, body.motion, rx - layout.symbolSize / 8, ry - layout.symbolSize / 8, fonts.textSmall, body.color);
    }

    if (!outer && data.positions) {
      const [px, py] = mundaneXY(layout, layout.rPos, body.mundane + shift);
      drawPositionLabel(ctx, body, px, py, fonts, colors.positions);
    }
  });
}

function collectBodyHoverTargets(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  fonts: FontSet,
  shifts: Map<number, number>,
  bodies: MundaneChartBody[],
  radius: number,
  chartRole: "primary" | "outer",
): MundaneHoverTarget[] {
  const pad = Math.max(6, Math.round(layout.symbolSize * 0.45));
  const out: MundaneHoverTarget[] = [];
  bodies.forEach((body) => {
    if (!body.hoverFlag) return;
    const shift = shifts.get(body.id) ?? 0;
    const [x, y] = mundaneXY(layout, radius, body.mundane + shift);
    const [w, h] = bodyTextSize(ctx, body, fonts);
    const left = x - layout.symbolSize / 2;
    const top = y - layout.symbolSize / 2;
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

function collectAspectHoverTargets(data: MundaneChartData, layout: Layout): MundaneHoverTarget[] {
  const aspects = data.aspects ?? [];
  if (aspects.length === 0) return [];
  const tolerance = Math.max(5, Math.round(layout.symbolSize * 0.32));
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
  textFontFamily: string,
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
  const layout = buildLayout(side, compound, data.showHouses);
  const fonts = buildFonts(layout, textFontFamily);

  ctx.clearRect(0, 0, side, side);
  drawFrame(ctx, data, layout);
  drawHouseNames(ctx, data, layout, fonts);
  drawAscMC(ctx, data, layout);
  drawMundaneAspects(ctx, data, layout, fonts);
  const shifts = arrangeBodies(ctx, data, layout, fonts, data.bodies, layout.rPlanet);
  drawPlanetLines(ctx, data, layout, shifts, data.bodies, layout.rInner, layout.rLLine, layout.rAsp, layout.rLLine2);
  const hoverTargets = collectAspectHoverTargets(data, layout);
  let secondaryShifts: Map<number, number> | null = null;
  if (compound && secondaryBodies.length > 0) {
    secondaryShifts = arrangeBodies(ctx, data, layout, fonts, secondaryBodies, layout.rOuterPlanet);
    drawPlanetLines(ctx, data, layout, secondaryShifts, secondaryBodies, layout.r30, layout.rOuterLine);
  }
  drawPlanets(ctx, data, layout, fonts, shifts, data.bodies, layout.rPlanet, layout.rRetr);
  hoverTargets.push(...collectBodyHoverTargets(ctx, layout, fonts, shifts, data.bodies, layout.rPlanet, "primary"));
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
  const compactPhone = side > 0 && side <= 390;
  const symbolSize = side > 0 ? side / 32 : 0;
  const infoFontSize = Math.max(compactPhone ? 11 : 10, symbolSize * (compactPhone ? 0.86 : 0.75));
  const edgeInset = side > 0 ? Math.max(compactPhone ? 10 : 0, side / 25) : 0;
  const topEdgeInset = compactPhone ? edgeInset : edgeInset + WX_TITLEBAR_OVERLAY_SAFE_TOP;
  const overlayTextColor = data?.colors?.houses ?? DEFAULT_COLORS.houses;
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

  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const s = Math.max(120, Math.floor(Math.min(rect.width, rect.height)));
      setSide(s);
    };
    raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  React.useEffect(() => {
    if (!data || !canvasRef.current) return;
    let cancelled = false;
    const draw = async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      if (cancelled || !canvasRef.current) return;
      const css = getComputedStyle(canvasRef.current);
      const textFontFamily = css.getPropertyValue("--morinus-font-text").trim() || "'FreeSans', ui-sans-serif, system-ui, sans-serif";
      hoverTargetsRef.current = drawMundaneChart(canvasRef.current, data, side, textFontFamily);
    };
    void draw();
    return () => {
      cancelled = true;
    };
  }, [data, side, styleRevision]);

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
      style={data?.colors?.background ? { backgroundColor: data.colors.background } : undefined}
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
                style={{ top: topEdgeInset, left: edgeInset, textAlign: "left" }}
              />
              <MundaneCornerLines
                lines={data.overlay.bottomLeft}
                color={overlayTextColor}
                fontSize={infoFontSize}
                style={{ bottom: edgeInset, left: edgeInset, textAlign: "left" }}
              />
            </>
          ) : null}
          {data.overlay?.showHouseSystem ? (
            <MundaneCornerLines
              lines={data.overlay.houseSystemLines}
              color={overlayTextColor}
              fontSize={infoFontSize}
              style={{ right: edgeInset, bottom: edgeInset, textAlign: "right" }}
            />
          ) : null}
        </>
      ) : error ? (
        <div className="text-[12px] text-destructive">{t("mundane.failed", { error })}</div>
      ) : (
        <div className="text-[12px] text-muted-foreground">{t("mundane.loading")}</div>
      )}
    </div>
  );
}

function MundaneCornerLines({
  lines,
  color,
  fontSize,
  style,
}: {
  lines: string[];
  color: string;
  fontSize: number;
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
        lineHeight: 1.1,
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
  const [visibleAnchor, setVisibleAnchor] = React.useState<MundaneFlagAnchor | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = React.useState({ width: 180, height: 96 });
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 });
  const activeAnchor = anchor && visibleAnchor?.key === anchor.key ? visibleAnchor : null;

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
  }, [activeAnchor]);

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
  const margin = 8;
  const xGap = 12;
  const yGap = 10;
  const cardWidth = Math.max(cardSize.width, compact ? 120 : 180);
  const cardHeight = Math.max(cardSize.height, compact ? 56 : 96);
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
        className="rounded-md border bg-background/95 shadow-md backdrop-blur-sm"
        style={{
          borderColor: rgbaCss(payload.accent, 0.55) ?? "var(--border)",
          paddingInline: compact ? 7 : 9,
          paddingBlock: compact ? 4 : 6,
          minWidth: compact ? undefined : 96,
          maxWidth: "min(360px, calc(100vw - 16px))",
        }}
      >
        <div className="flex items-baseline whitespace-nowrap" style={{ gap: compact ? 4 : 8 }}>
          {glyph ? (
            <span
              className="leading-none text-foreground/90"
              style={{
                color: compact ? rgbCss(payload.accent) : undefined,
                fontFamily: '"AriesMorinus"',
                fontSize: compact ? 14 : 16,
              }}
            >
              {glyph}
            </span>
          ) : null}
          <span className="font-semibold leading-tight text-foreground/90" style={{ fontSize: compact ? 11 : 13 }}>
            {title}
          </span>
        </div>
        {rows.length > 0 ? (
          <div
            className="grid items-baseline gap-x-2 gap-y-[2px]"
            style={{
              gridTemplateColumns: "auto 1fr",
              fontSize: compact ? 10 : 11,
              marginTop: compact ? 4 : 6,
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

  return (
    <>
      <span className="whitespace-nowrap leading-tight text-foreground/45">{label}</span>
      {spans && spans.length > 0 ? (
        <span className="whitespace-nowrap leading-tight text-foreground/85">
          {spans.map((span, i) => (
            <span
              key={i}
              style={{
                color: rgbCss(span.colour),
                fontFamily: span.glyph ? '"AriesMorinus"' : undefined,
              }}
            >
              {span.text}
            </span>
          ))}
        </span>
      ) : (
        <span className="whitespace-nowrap leading-tight text-foreground/85" style={{ color: rgbCss(colour) }}>
          {value}
        </span>
      )}
    </>
  );
}
