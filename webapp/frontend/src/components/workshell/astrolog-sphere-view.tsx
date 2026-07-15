// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { CanvasDraw } from "@/lib/chart/canvas-draw";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import { awaitFonts } from "@/lib/chart/draw-chart";
import { useStyleRevision } from "@/hooks/use-style-revision";
import {
  fetchAstrologSphere,
  type AstrologSphereGeometry,
  type AstrologSphereGlyphAnchor,
  type AstrologSpherePoint,
  type AstrologSpherePolyline,
} from "@/lib/daemon/client";
import { useThemeStore } from "@/stores/theme-store";
import { useT } from "@/lib/i18n/i18n";

type Layers = {
  houses: boolean;
  decans: boolean;
  bounds: boolean;
  bodies: boolean;
  back: boolean;
};

type SphereView = {
  q: Quaternion;
  zoom: number;
};

type ProjectedPoint = {
  x: number;
  y: number;
  z: number;
  front: boolean;
};

type Quaternion = [number, number, number, number];
type Vec3 = [number, number, number];

const DEFAULT_LAYERS: Layers = {
  houses: true,
  decans: true,
  bounds: true,
  bodies: true,
  back: true,
};

const DEFAULT_VIEW: SphereView = { q: [1, 0, 0, 0], zoom: 1 };
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 4.5;

type Layout = {
  cx: number;
  cy: number;
  r: number;
};

const WIRE = {
  background: "#000000",
  white: "#ffffff",
  faint: "rgba(255,255,255,0.22)",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vecNormalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function quatNormalize(q: Quaternion): Quaternion {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function quatMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return quatNormalize([
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ]);
}

function quatFromUnitVectors(from: Vec3, to: Vec3): Quaternion {
  const dot = clamp(vecDot(from, to), -1, 1);
  if (dot < -0.999999) {
    const axis = Math.abs(from[0]) < 0.9 ? vecCross(from, [1, 0, 0]) : vecCross(from, [0, 1, 0]);
    const n = vecNormalize(axis);
    return [0, n[0], n[1], n[2]];
  }
  const cross = vecCross(from, to);
  return quatNormalize([1 + dot, cross[0], cross[1], cross[2]]);
}

function quatRotateVector(q: Quaternion, v: Vec3): Vec3 {
  const qv: Quaternion = [0, v[0], v[1], v[2]];
  const qc: Quaternion = [q[0], -q[1], -q[2], -q[3]];
  const r = quatMultiplyRaw(quatMultiplyRaw(q, qv), qc);
  return [r[1], r[2], r[3]];
}

function quatMultiplyRaw(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function trackballVector(clientX: number, clientY: number, rect: DOMRect): Vec3 {
  const r = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
  const x = (clientX - (rect.left + rect.width / 2)) / r;
  const y = (clientY - (rect.top + rect.height / 2)) / r;
  const d = x * x + y * y;
  if (d <= 1) return [x, y, Math.sqrt(1 - d)];
  return vecNormalize([x, y, 0]);
}

function transformPoint(p: AstrologSpherePoint, view: SphereView): ProjectedPoint {
  const [x, y, z] = quatRotateVector(view.q, [p.x, p.y, p.z]);
  return { x, y, z, front: z >= 0 };
}

function mapPoint(layout: Layout, p: AstrologSpherePoint, view: SphereView): [number, number, ProjectedPoint] {
  const projected = transformPoint(p, view);
  return [layout.cx + projected.x * layout.r, layout.cy + projected.y * layout.r, projected];
}

function drawSphereFrame(draw: CanvasDraw, layout: Layout) {
  draw.circle([layout.cx, layout.cy], layout.r, {
    outline: WIRE.white,
    width: Math.max(0.75, layout.r / 520),
  });
}

function clipToSphere(draw: CanvasDraw, layout: Layout) {
  draw.ctx.beginPath();
  draw.ctx.arc(layout.cx, layout.cy, layout.r, 0, Math.PI * 2);
  draw.ctx.clip();
}

function wireColor(line: AstrologSpherePolyline): string {
  if (line.kind === "bound" || line.kind === "decan") return WIRE.faint;
  return WIRE.white;
}

function strokePolyline(
  draw: CanvasDraw,
  layout: Layout,
  line: AstrologSpherePolyline,
  view: SphereView,
  opts: { backVisible: boolean; frontOpacity?: number; backOpacity?: number; widthScale?: number } = { backVisible: true },
) {
  const pts = line.points;
  if (pts.length < 2) return;
  const ctx = draw.ctx;
  const width = Math.max(0.35, line.width * (opts.widthScale ?? 1));
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const [x1, y1, pa] = mapPoint(layout, a, view);
    const [x2, y2, pb] = mapPoint(layout, b, view);
    const front = pa.front || pb.front;
    if (!front && !opts.backVisible) continue;
    const opacity = front ? opts.frontOpacity ?? 1 : opts.backOpacity ?? 0.16;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = wireColor(line);
    ctx.lineWidth = width;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    if (line.dash.length) ctx.setLineDash(line.dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawCenteredGlyph(
  draw: CanvasDraw,
  layout: Layout,
  anchor: AstrologSphereGlyphAnchor,
  view: SphereView,
  size: number,
  fill: string,
  opacity = 1,
) {
  if (!anchor.glyph) return;
  const [x, y] = mapPoint(layout, anchor.point, view);
  const [w, h] = draw.textsize(anchor.glyph, { font: '"AriesMorinus"', size });
  draw.ctx.save();
  draw.ctx.globalAlpha = opacity;
  draw.text([x - w / 2, y - h / 2], anchor.glyph, {
    fill,
    font: '"AriesMorinus"',
    size,
  });
  draw.ctx.restore();
}

function drawCenteredText(
  draw: CanvasDraw,
  layout: Layout,
  anchor: AstrologSphereGlyphAnchor,
  view: SphereView,
  size: number,
  fill: string,
  font: string,
  opacity = 1,
) {
  if (!anchor.glyph) return;
  const [x, y] = mapPoint(layout, anchor.point, view);
  const [w, h] = draw.textsize(anchor.glyph, { font, size });
  draw.ctx.save();
  draw.ctx.globalAlpha = opacity;
  draw.text([x - w / 2, y - h / 2], anchor.glyph, {
    fill,
    font,
    size,
  });
  draw.ctx.restore();
}

function drawBodies(draw: CanvasDraw, layout: Layout, geo: AstrologSphereGeometry, view: SphereView, backVisible: boolean) {
  const bodySize = Math.max(10, Math.min(16, layout.r / 21));
  const dotR = Math.max(0.75, layout.r / 360);
  for (const body of geo.bodies) {
    const [x, y, projected] = mapPoint(layout, body.point, view);
    if (!projected.front && !backVisible) continue;
    const opacity = projected.front ? 0.94 : 0.16;
    draw.circle([x, y], dotR, { fill: WIRE.white, opacity });
    if (projected.front) drawCenteredGlyph(draw, layout, body, view, bodySize, WIRE.white, opacity);
  }
}

function drawLabels(
  draw: CanvasDraw,
  layout: Layout,
  geo: AstrologSphereGeometry,
  layers: Layers,
  view: SphereView,
  fontText: string,
) {
  const signSize = Math.max(8, Math.min(12, layout.r / 31));
  const houseSize = Math.max(6, Math.min(9, layout.r / 44));
  const decanSize = Math.max(5, Math.min(7, layout.r / 68));
  const boundSize = Math.max(4, Math.min(6, layout.r / 78));

  for (const label of geo.signLabels) {
    const projected = transformPoint(label.point, view);
    drawCenteredGlyph(draw, layout, label, view, signSize, WIRE.white, projected.front ? 0.76 : 0.08);
  }
  if (layers.houses) {
    for (const label of geo.houseLabels) {
      const projected = transformPoint(label.point, view);
      drawCenteredText(draw, layout, label, view, houseSize, WIRE.white, fontText, projected.front ? 0.66 : 0.08);
    }
  }
  if (layers.decans) {
    for (const label of geo.decanLabels) {
      if (transformPoint(label.point, view).front) drawCenteredGlyph(draw, layout, label, view, decanSize, WIRE.white, 0.35);
    }
  }
  if (layers.bounds) {
    for (const label of geo.boundLabels) {
      if (transformPoint(label.point, view).front) drawCenteredGlyph(draw, layout, label, view, boundSize, WIRE.white, 0.32);
    }
  }
}

function render(
  canvas: HTMLCanvasElement,
  geo: AstrologSphereGeometry,
  layers: Layers,
  cssW: number,
  cssH: number,
  fontText: string,
  view: SphereView,
) {
  const draw = new CanvasDraw(canvas);
  draw.setDefaultFont(fontText);
  draw.resize(cssW, cssH);
  draw.fillBackground(WIRE.background);
  const size = Math.min(cssW, cssH);
  if (size <= 0) return;
  const layout: Layout = {
    cx: cssW / 2,
    cy: cssH / 2,
    r: size * 0.43 * view.zoom,
  };
  const widthScale = Math.max(0.55, layout.r / 440);
  drawSphereFrame(draw, layout);

  draw.ctx.save();
  clipToSphere(draw, layout);
  for (const line of geo.reference) {
    const isTick = line.kind === "horizonTick" || line.kind === "primeTick" || line.kind === "eclipticTick";
    strokePolyline(draw, layout, line, view, {
      backVisible: layers.back,
      frontOpacity: isTick ? 0.72 : 0.9,
      backOpacity: isTick ? 0.08 : 0.12,
      widthScale,
    });
  }
  for (const line of geo.signBoundaries) {
    strokePolyline(draw, layout, line, view, { backVisible: layers.back, frontOpacity: 0.9, backOpacity: 0.1, widthScale });
  }
  if (layers.decans) {
    for (const line of geo.decanBoundaries) {
      strokePolyline(draw, layout, line, view, { backVisible: layers.back, frontOpacity: 0.25, backOpacity: 0.04, widthScale });
    }
  }
  if (layers.houses) {
    for (const line of geo.houses) {
      strokePolyline(draw, layout, line, view, { backVisible: layers.back, frontOpacity: 0.9, backOpacity: 0.1, widthScale });
    }
  }
  if (layers.bounds) {
    for (const line of geo.boundTicks) {
      strokePolyline(draw, layout, line, view, { backVisible: layers.back, frontOpacity: 0.55, backOpacity: 0.05, widthScale });
    }
  }
  draw.ctx.restore();

  drawLabels(draw, layout, geo, layers, view, fontText);
  if (layers.bodies) drawBodies(draw, layout, geo, view, layers.back);
  draw.circle([layout.cx, layout.cy], Math.max(0.75, layout.r / 360), { fill: WIRE.white });
}

export function AstrologSphereView({
  sourceName,
  source,
  documentId,
}: {
  sourceName: string;
  source?: string | null;
  documentId?: string;
}) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [geo, setGeo] = React.useState<AstrologSphereGeometry | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [layers, setLayers] = React.useState<Layers>(DEFAULT_LAYERS);
  const [view, setView] = React.useState<SphereView>(DEFAULT_VIEW);
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const t = useT();
  const dragRef = React.useRef<{
    pointerId: number;
    vector: Vec3;
    q: Quaternion;
  } | null>(null);
  const [fontsReadyFor, setFontsReadyFor] = React.useState<string | null>(null);
  const theme = useThemeStore((s) => s.theme);
  const styleRevision = useStyleRevision();
  const chartTextFont = morinusTextFontFromTokens(theme?.appTokens);
  const fontsReady = fontsReadyFor === chartTextFont;

  React.useEffect(() => {
    let cancelled = false;
    void awaitFonts(chartTextFont).then(() => {
      if (!cancelled) setFontsReadyFor(chartTextFont);
    });
    return () => {
      cancelled = true;
    };
  }, [chartTextFont]);

  React.useEffect(() => {
    const controller = new AbortController();
    void fetchAstrologSphere(
      sourceName,
      { source: source ?? undefined, documentId, rotation: 0, tilt: 0 },
      controller.signal,
    )
      .then((payload) => {
        setGeo(payload);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("[astrolog-sphere]", err);
        setError(String((err as Error).message ?? err));
      });
    return () => {
      controller.abort();
    };
  }, [sourceName, source, documentId]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !geo || !fontsReady) return;
    const paint = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      render(canvas, geo, layers, rect.width, rect.height, chartTextFont, view);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [chartTextFont, fontsReady, geo, layers, view, styleRevision]);

  const toggle = React.useCallback((key: keyof Layers) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  React.useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      vector: trackballVector(event.clientX, event.clientY, rect),
      q: view.q,
    };
  }, [view.q]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const nextVector = trackballVector(event.clientX, event.clientY, rect);
    const delta = quatFromUnitVectors(drag.vector, nextVector);
    setView((current) => ({ ...current, q: quatMultiply(delta, drag.q) }));
  }, []);

  const handlePointerEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const resetView = React.useCallback(() => setView(DEFAULT_VIEW), []);

  const handleWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.001);
    setView((current) => ({ ...current, zoom: clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM) }));
  }, []);

  const handleContextMenu = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const toggleFromMenu = React.useCallback((key: keyof Layers) => {
    toggle(key);
    setMenu(null);
  }, [toggle]);

  return (
    <div className="font-morinus-text relative flex flex-1 min-h-0 bg-black">
      <div
        ref={wrapRef}
        className="relative flex-1 min-h-0 touch-none cursor-grab overflow-hidden active:cursor-grabbing"
        onContextMenu={handleContextMenu}
        onDoubleClick={resetView}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerEnd}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onWheel={handleWheel}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-destructive">
            {t("sphere.failed", { error })}
          </div>
        ) : !geo ? (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted-foreground">
            {t("sphere.loading")}
          </div>
        ) : null}
        {menu ? (
          <SphereContextMenu
            layers={layers}
            onResetView={() => {
              resetView();
              setMenu(null);
            }}
            onToggle={toggleFromMenu}
            x={menu.x}
            y={menu.y}
          />
        ) : null}
      </div>
    </div>
  );
}

function SphereContextMenu({
  layers,
  onToggle,
  onResetView,
  x,
  y,
}: {
  layers: Layers;
  onToggle: (key: keyof Layers) => void;
  onResetView: () => void;
  x: number;
  y: number;
}) {
  const t = useT();
  const items: Array<[keyof Layers, string]> = [
    ["houses", t("sphere.houses")],
    ["decans", t("sphere.decans")],
    ["bounds", t("sphere.bounds")],
    ["bodies", t("sphere.bodies")],
    ["back", t("sphere.back")],
  ];
  return (
    <div
      role="menu"
      className="fixed z-50 min-w-[132px] border border-white bg-black px-0 py-1 text-[11px] leading-none text-white"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onToggle(key)}
          className="block w-full bg-black px-3 py-1.5 text-left text-white hover:bg-white hover:text-black"
        >
          {layers[key] ? "* " : "  "}
          {label}
        </button>
      ))}
      <button
        type="button"
        onClick={onResetView}
        className="mt-1 block w-full border-t border-white bg-black px-3 py-1.5 text-left text-white hover:bg-white hover:text-black"
      >
        {t("sphere.resetView")}
      </button>
    </div>
  );
}
