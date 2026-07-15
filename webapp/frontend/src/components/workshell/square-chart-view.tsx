// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { useStyleRevision } from "@/hooks/use-style-revision";
import { fetchSquareChart, type SquareChartData, type SquareChartPlanet } from "@/lib/daemon/client";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useT } from "@/lib/i18n/i18n";

// Square Chart renderer. The wx source is squarechart.py: drawChart() owns the
// proportions, line topology, font scale, central text block, cusp coordinate
// table, and planet-stack anchors. React owns only the retained Tauri surface.

type FontSet = {
  text: string;
  textSmall: string;
  textSmaller: string;
  morinus: string;
  morinusSmall: string;
};

type Point = [number, number];
type CuspAnchor = [Point, Point, Point];

const SMALL_SIZE = 400;
const MEDIUM_SIZE = 600;
const DEFAULT_COLORS = {
  background: "#232428",
  frame: "#dcdcdd",
  texts: "#98999c",
  positions: "#ffffff",
  signs: "#d7d7d9",
};

function z2(n: number): string {
  return String(n).padStart(2, "0");
}

function rjust2(n: number): string {
  return String(n).padStart(2, " ");
}

function lineWidth(chartSize: number, outer: boolean): number {
  if (outer) {
    if (chartSize <= SMALL_SIZE) return 2;
    if (chartSize <= MEDIUM_SIZE) return 3;
    return 4;
  }
  if (chartSize <= SMALL_SIZE) return 1;
  if (chartSize <= MEDIUM_SIZE) return 2;
  return 3;
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

function textWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  ctx.font = font;
  return ctx.measureText(text).width;
}

function cuspAnchors(cx: number, cy: number, r: number, f: number): CuspAnchor[] {
  return [
    [[cx - 3 * r / 4 - 3 * f / 2, cy - r / 3 + f], [cx - 3 * r / 4 - f / 2, cy - r / 3], [cx - 3 * r / 4 + f / 2, cy - r / 3 - f / 2]],
    [[cx - 3 * r / 4 - f, cy + r / 3 - 3 * f], [cx - 3 * r / 4, cy + r / 3 - 2 * f - f / 4], [cx - 3 * r / 4 + f, cy + r / 3 - f]],
    [[cx - 3 * r / 4 - 5 * f / 2, cy + 3 * r / 4 + 4 * f / 5], [cx - 3 * r / 4 - 3 * f / 2, cy + 3 * r / 4 - f / 5], [cx - 3 * r / 4 - f / 2, cy + 3 * r / 4 - 4 * f / 5]],
    [[cx - r / 4 - 2 * f, cy + 3 * r / 4 - f], [cx - r / 4 - f, cy + 3 * r / 4 - f / 4], [cx - r / 4, cy + 3 * r / 4 + f]],
    [[cx + r / 4 - 5 * f / 2, cy + 3 * r / 4 + 4 * f / 5], [cx + r / 4 - 3 * f / 2, cy + 3 * r / 4 - f / 5], [cx + r / 4 - f / 2, cy + 3 * r / 4 - 4 * f / 5]],
    [[cx + 3 * r / 4 - 2 * f, cy + 3 * r / 4 - f], [cx + 3 * r / 4 - f, cy + 3 * r / 4 - f / 4], [cx + 3 * r / 4, cy + 3 * r / 4 + f]],
    [[cx + 3 * r / 4 - 3 * f / 4, cy + r / 3 - f / 2], [cx + 3 * r / 4 + f / 4, cy + r / 3 - 3 * f / 2], [cx + 3 * r / 4 + 5 * f / 4, cy + r / 3 - 9 * f / 4]],
    [[cx + 3 * r / 4 - 3 * f / 2, cy - r / 3 + f], [cx + 3 * r / 4 - f / 4, cy - r / 3 + 7 * f / 4], [cx + 3 * r / 4 + 3 * f / 4, cy - r / 3 + 11 * f / 4]],
    [[cx + 3 * r / 4 - f, cy - 3 * r / 4 + f], [cx + 3 * r / 4, cy - 3 * r / 4], [cx + 3 * r / 4 + f, cy - 3 * r / 4 - 3 * f / 4]],
    [[cx + r / 4 - f / 4, cy - 3 * r / 4 - f], [cx + r / 4 + 3 * f / 4, cy - 3 * r / 4 - f / 4], [cx + r / 4 + 7 * f / 4, cy - 3 * r / 4 + f]],
    [[cx - r / 4 - f, cy - 3 * r / 4 + f], [cx - r / 4, cy - 3 * r / 4], [cx - r / 4 + f, cy - 3 * r / 4 - 3 * f / 4]],
    [[cx - 3 * r / 4, cy - 3 * r / 4 - f], [cx - 3 * r / 4 + f, cy - 3 * r / 4], [cx - 3 * r / 4 + 2 * f, cy - 3 * r / 4 + 5 * f / 4]],
  ];
}

function planetAnchors(cx: number, cy: number, r: number, f: number): Point[] {
  return [
    [cx - 3 * r / 4 - 3 * f / 4, cy - f / 2],
    [cx - r + f / 2, cy + r / 2 - f / 2],
    [cx - 3 * r / 4 + f, cy + 3 * r / 4 + f],
    [cx - r / 5 + f, cy + r / 2 + 2 * f],
    [cx + r / 2 - 5 * f / 2, cy + 3 * r / 4 + f],
    [cx + 2 * r / 3 + f / 2, cy + r / 2 - f / 2],
    [cx + r / 2 + f / 2, cy - f / 2],
    [cx + 2 * r / 3 + f / 2, cy - r / 2 - f / 2],
    [cx + r / 2 - 2 * f, cy - r + 2 * f],
    [cx - r / 6 + f, cy - 3 * r / 4 + f / 2],
    [cx - 3 * r / 4 + 2 * f, cy - r + 2 * f],
    [cx - r + f / 2, cy - r / 2 - f / 2],
  ];
}

function drawFrame(ctx: CanvasRenderingContext2D, side: number, cx: number, cy: number, r: number, color: string) {
  const outerW = lineWidth(side, true);
  const innerW = lineWidth(side, false);

  ctx.strokeStyle = color;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.lineWidth = outerW;
  ctx.strokeRect(cx - r, cy - r, 2 * r + outerW, 2 * r + outerW);

  ctx.lineWidth = innerW;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx - r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy - r);
  ctx.moveTo(cx - r, cy - r);
  ctx.lineTo(cx - r / 2, cy - r / 2);
  ctx.moveTo(cx - r, cy + r);
  ctx.lineTo(cx - r / 2, cy + r / 2);
  ctx.moveTo(cx + r, cy + r);
  ctx.lineTo(cx + r / 2, cy + r / 2);
  ctx.moveTo(cx + r, cy - r);
  ctx.lineTo(cx + r / 2, cy - r / 2);
  ctx.stroke();
  ctx.strokeRect(cx - r / 2, cy - r / 2, r + 1, r + 1);
}

function drawPlanetRow(
  ctx: CanvasRenderingContext2D,
  p: SquareChartPlanet,
  x: number,
  y: number,
  fonts: FontSet,
  fontSize: number,
) {
  const wpl = textWidth(ctx, "F", fonts.morinusSmall);
  const wpl2 = textWidth(ctx, p.glyph, fonts.morinusSmall);
  const wr = textWidth(ctx, "R", fonts.textSmaller);
  const wsp = textWidth(ctx, " ", fonts.textSmall);
  const txtdeg = `${z2(p.deg)}°`;
  const txtmin = `${z2(p.min)}'`;
  const wdeg = textWidth(ctx, txtdeg, fonts.textSmall);
  const wsg = textWidth(ctx, p.signGlyph, fonts.morinusSmall);

  drawText(ctx, p.glyph, x, y, fonts.morinusSmall, p.color);
  if (p.motion) {
    drawText(ctx, p.motion, x + wpl2, y + fontSize / 2, fonts.textSmaller, p.color);
  }
  drawText(ctx, txtdeg, x + wpl + wr + wsp, y, fonts.textSmall, p.color);
  drawText(ctx, p.signGlyph, x + wpl + wr + wsp + wdeg, y, fonts.morinusSmall, p.color);
  drawText(ctx, txtmin, x + wpl + wr + wsp + wdeg + wsp + wsg, y, fonts.textSmaller, p.color);
}

function drawSquareChart(canvas: HTMLCanvasElement, data: SquareChartData, side: number, textFontFamily: string) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(side * dpr));
  canvas.height = Math.max(1, Math.round(side * dpr));
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = data.colors ?? DEFAULT_COLORS;
  const maxradius = side / 2;
  const radius = maxradius * 0.9;
  const cx = side / 2;
  const cy = side / 2;
  const symbolSize = Math.max(8, maxradius / 16);
  const smallSize = Math.max(6, maxradius / 18);
  const fontSize = Math.max(6, Math.round(symbolSize));
  const smallPx = Math.max(6, Math.round(smallSize));
  const textSmallPx = Math.max(6, Math.round(3 * fontSize / 4));
  const textSmallerPx = Math.max(6, Math.round(fontSize / 2));
  const fonts: FontSet = {
    text: `${fontSize}px ${textFontFamily}`,
    textSmall: `${textSmallPx}px ${textFontFamily}`,
    textSmaller: `${textSmallerPx}px ${textFontFamily}`,
    morinus: `${fontSize}px "AriesMorinus"`,
    morinusSmall: `${smallPx}px "AriesMorinus"`,
  };
  const space = fontSize / 5;
  const lineHeight = space + fontSize + space;

  ctx.clearRect(0, 0, side, side);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, side, side);
  drawFrame(ctx, side, cx, cy, radius, colors.frame);

  const infoX = cx - radius / 3;
  let infoY = cy - radius / 3;
  const dayHour = data.dayHour ?? [];
  if (dayHour.length) infoY -= lineHeight;
  data.info.forEach((line, i) => {
    drawText(ctx, line, infoX, infoY + i * lineHeight, fonts.text, colors.texts);
  });
  dayHour.slice(0, 2).forEach((line, i) => {
    const y = infoY + (data.info.length + i) * lineHeight;
    drawText(ctx, line.glyph, infoX, y, fonts.morinus, colors.texts);
    const glyphW = textWidth(ctx, line.glyph, fonts.morinus);
    const spaceW = textWidth(ctx, " ", fonts.text);
    drawText(ctx, line.label, infoX + glyphW + spaceW, y, fonts.text, colors.texts);
  });

  const cusp = cuspAnchors(cx, cy, radius, fontSize);
  const plist = planetAnchors(cx, cy, radius, fontSize);
  for (let i = 0; i < 12; i++) {
    const c = data.cusps[i];
    if (c) {
      drawText(ctx, `${rjust2(c.deg)}°`, cusp[i][0][0], cusp[i][0][1], fonts.textSmall, colors.positions);
      drawText(ctx, c.signGlyph, cusp[i][1][0], cusp[i][1][1], fonts.morinusSmall, colors.signs);
      drawText(ctx, `${z2(c.min)}'`, cusp[i][2][0], cusp[i][2][1], fonts.textSmaller, colors.positions);
    }

    const planets = data.houses[i]?.planets ?? [];
    const lh = fontSize;
    let lhoff = 0;
    if (planets.length > 1 && planets.length % 2 === 0) lhoff -= lh / 2;
    if (planets.length > 2) {
      let shift = planets.length;
      if (shift % 2 === 0) shift -= 1;
      lhoff -= Math.trunc(shift / 2) * lh;
    }
    for (const p of planets) {
      drawPlanetRow(ctx, p, plist[i][0], plist[i][1] + lhoff, fonts, fontSize);
      lhoff += lh;
    }
  }
}

export function SquareChartView({
  documentId,
  parentDocumentId,
  sourceName,
  source,
}: {
  documentId: string;
  parentDocumentId: string | null;
  sourceName: string;
  source?: string;
}) {
  const t = useT();
  const styleRevision = useStyleRevision();
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [data, setData] = React.useState<SquareChartData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [side, setSide] = React.useState(600);
  const parentSessionSeq = useDaemonWorkspaceStore((s) => {
    const change = s.lastSessionChange;
    if (!parentDocumentId || !change || change.docId !== parentDocumentId) return 0;
    return change.seq;
  });

  React.useEffect(() => {
    let cancelled = false;
    fetchSquareChart(sourceName, { source, documentId })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String((err as Error).message ?? err));
        console.error("[square-chart]", err);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, sourceName, source, parentSessionSeq]);

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
      drawSquareChart(canvasRef.current, data, side, textFontFamily);
    };
    void draw();
    return () => {
      cancelled = true;
    };
  }, [data, side, styleRevision]);

  return (
    <div
      ref={wrapRef}
      className="font-morinus-text relative flex flex-1 min-h-0 items-center justify-center overflow-hidden bg-background"
      style={data?.colors?.background ? { backgroundColor: data.colors.background } : undefined}
    >
      {data ? (
        <canvas ref={canvasRef} className="block" aria-label={t("square.chartAria")} />
      ) : error ? (
        <div className="text-[12px] text-destructive">{t("square.failed", { error })}</div>
      ) : (
        <div className="text-[12px] text-muted-foreground">{t("square.loading")}</div>
      )}
    </div>
  );
}
