// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChartContextMenu } from "./chart-context-menu";
import { ChartHoverFlag, type FlagAnchor } from "./chart-hover-flag";
import { CanvasDraw } from "@/lib/chart/canvas-draw";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import {
  registerChartExportRenderer,
  renderCanvasChartExport,
} from "@/lib/chart/chart-export-registry";
import {
  drawMultiwheel,
  findMultiwheelHitRegion,
  resolveMultiwheelLayout,
  type MultiwheelHitRegion,
} from "@/lib/chart/multiwheel-render-style";
import {
  applyProfileColorsToSnapshot,
  readPaletteFromTheme,
  readPaletteProfileOverrides,
} from "@/lib/chart/palette";
import { acknowledgePaintedDocumentSnapshot } from "@/lib/chart/painted-snapshot-registry";
import { perfNow, recordChartPerf } from "@/lib/chart/perf";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import {
  projectWheelAuthoringStyle,
  resolveWheelRenderStyleFromTokens,
} from "@/lib/chart/wheel-render-style";
import { compileFlatWheelAuthoringOverrides } from "@/lib/style-lab/wheel-authoring-adapter";
import { cn } from "@/lib/utils";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useThemeStore } from "@/stores/theme-store";
import { hoverRegionKey, useWorkspaceStore, type HoverRegion } from "@/stores/workspace-store";

function multiwheelHitToHover(hit: MultiwheelHitRegion): HoverRegion {
  const identity = {
    chartRole: hit.chartRole,
    ringIndex: hit.ringIndex,
  } as const;
  if (hit.kind === "planet") {
    return {
      kind: "planet",
      planetId: hit.planetId,
      seId: hit.seId,
      longitude: hit.longitude,
      latitude: hit.latitude,
      speed: hit.speed,
      house: hit.house,
      dignity: hit.dignity,
      ...identity,
    };
  }
  if (hit.kind === "vertex") {
    return { kind: "vertex", longitude: hit.longitude, house: hit.house, ...identity };
  }
  if (hit.kind === "fortune") {
    return { kind: "fortune", longitude: hit.longitude, ...identity };
  }
  if (hit.kind === "syzygy") {
    return {
      kind: "syzygy",
      longitude: hit.longitude,
      house: hit.house,
      label: hit.label,
      ...identity,
    };
  }
  if (hit.kind === "angle") {
    return {
      kind: "angle",
      angleId: hit.angleId,
      longitude: hit.longitude,
      ...identity,
    };
  }
  return {
    kind: "eclipse",
    longitude: hit.longitude,
    house: hit.house,
    label: hit.label,
    ...identity,
  };
}

export function MultiwheelChartCanvas({
  chart,
  className,
  paintEffectsActive,
  appControlsEnabled = true,
  inheritAppTheme = true,
}: {
  chart: ChartRenderSnapshot;
  className?: string;
  paintEffectsActive?: boolean;
  appControlsEnabled?: boolean;
  inheritAppTheme?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const hitRegionsRef = useRef<MultiwheelHitRegion[]>([]);
  const hoveredKeyRef = useRef<string | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const flagAnchorRef = useRef<FlagAnchor | null>(null);
  const flagAnchorTokenRef = useRef(0);
  const [flagAnchor, setFlagAnchor] = useState<FlagAnchor | null>(null);
  const setHoveredRegion = useWorkspaceStore((state) => state.setHoveredRegion);
  const setInspectorActiveRegion = useWorkspaceStore((state) => state.setInspectorActiveRegion);
  const inspectorOpen = useFrameLayoutStore((state) => state.inspectorOpen);
  const appTheme = useThemeStore((state) => state.theme);
  const theme = inheritAppTheme ? appTheme : null;
  const renderSnapshot = useMemo(
    () => applyProfileColorsToSnapshot(chart, theme),
    [chart, theme],
  );
  const palette = useMemo(() => ({
    ...readPaletteFromTheme(theme),
    ...(chart.primaryChart.palette ?? {}),
    ...readPaletteProfileOverrides(theme),
  }), [chart.primaryChart.palette, theme]);
  const fontUi = morinusTextFontFromTokens(theme?.appTokens);
  const fontSymbols = theme?.appTokens?.["--aries-font-symbols"]?.trim()
    || '"AriesMorinus"';
  const wheelRenderStyle = useMemo(
    () => resolveWheelRenderStyleFromTokens(
      (cssVar) => theme?.chartPalette?.[cssVar],
      {
        palette,
        revision: theme?.styleRevision ?? 0,
        fontSymbols,
        fontUi,
        authoringOverrides: compileFlatWheelAuthoringOverrides(
          theme?.profileOverrides?.wheelAuthoring ?? {},
        ),
      },
    ),
    [fontSymbols, fontUi, palette, theme],
  );

  const setTrackedFlagAnchor = useCallback((next: FlagAnchor | null) => {
    flagAnchorRef.current = next;
    setFlagAnchor(next);
  }, []);

  const updateHoverFromClientPoint = useCallback((clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (
      clientX < rect.left
      || clientX > rect.right
      || clientY < rect.top
      || clientY > rect.bottom
    ) {
      hoveredKeyRef.current = null;
      setHoveredRegion(null);
      setTrackedFlagAnchor(null);
      return;
    }
    const hit = findMultiwheelHitRegion(
      hitRegionsRef.current,
      clientX - rect.left,
      clientY - rect.top,
    );
    const nextHover = hit ? multiwheelHitToHover(hit) : null;
    const nextKey = hoverRegionKey(nextHover);
    if (hoveredKeyRef.current === nextKey) {
      const tracked = flagAnchorRef.current;
      if (hit && nextHover && tracked) {
        const x = rect.left + hit.x;
        const y = rect.top + hit.y;
        if (Math.abs(tracked.x - x) >= 0.5 || Math.abs(tracked.y - y) >= 0.5) {
          setTrackedFlagAnchor({
            region: nextHover,
            x,
            y,
            token: tracked.token,
          });
        }
      }
      return;
    }
    hoveredKeyRef.current = nextKey;
    setHoveredRegion(nextHover);
    if (hit && nextHover) {
      flagAnchorTokenRef.current += 1;
      setTrackedFlagAnchor({
        region: nextHover,
        x: rect.left + hit.x,
        y: rect.top + hit.y,
        token: flagAnchorTokenRef.current,
      });
    } else {
      setTrackedFlagAnchor(null);
    }
  }, [setHoveredRegion, setTrackedFlagAnchor]);

  useEffect(() => {
    const documentId = chart.document?.documentId;
    if (!documentId) return;
    return registerChartExportRenderer(documentId, (request) => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("multi-wheel canvas is unavailable");
      return renderCanvasChartExport(canvas, request);
    });
  }, [chart.document?.documentId]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let cancelled = false;

    const paint = () => {
      if (cancelled) return;
      const startedAt = perfNow();
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const rings = renderSnapshot.rings ?? [];
      if (rings.length < 3) return;
      const draw = new CanvasDraw(canvas);
      draw.resize(rect.width, rect.height);
      const title = document.querySelector<HTMLElement>("[data-aries-titlebar-title]");
      const titleRect = title?.getBoundingClientRect();
      const topBoundary = titleRect && titleRect.bottom > rect.top && titleRect.top < rect.bottom
        ? Math.max(0, Math.min(rect.height, titleRect.bottom - rect.top + 4))
        : 0;
      const availableHeight = Math.max(1, rect.height - topBoundary);
      const side = Math.min(rect.width, availableHeight);
      const maxRadius = Math.max(80, side * 0.475);
      const center: [number, number] = [
        rect.width / 2,
        topBoundary + availableHeight / 2,
      ];
      const rootOptions = rings[0].options;
      const layout = resolveMultiwheelLayout({
        maxRadius,
        ringCount: rings.length,
        ringZodiac: renderSnapshot.ringZodiac ?? "rim",
        bodiesPerRing: rings.map((ring) => ring.planets.length),
        showTerms: Boolean(rootOptions.showTerms && rootOptions.terms?.length),
        showDecans: Boolean(rootOptions.showDecans && rootOptions.decans?.length),
      });
      const angloStyle = projectWheelAuthoringStyle(wheelRenderStyle, layout.maxRadius, "anglo");
      hitRegionsRef.current = drawMultiwheel(
        draw,
        center,
        layout,
        renderSnapshot,
        palette,
        { symbols: fontSymbols, ui: fontUi },
        { width: rect.width, height: rect.height, topBoundary },
        angloStyle,
      );
      const lastPointer = lastPointerClientRef.current;
      if (lastPointer) {
        updateHoverFromClientPoint(lastPointer.x, lastPointer.y);
      }
      acknowledgePaintedDocumentSnapshot(chart.document?.documentId, chart);
      recordChartPerf("chart-canvas-paint", {
        docId: chart.document?.documentId ?? null,
        mode: chart.overlayRenderMode,
        renderer: "multiwheel",
        ringCount: rings.length,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        chartSize: Math.round(side),
        totalMs: perfNow() - startedAt,
      });
    };
    const schedule = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        paint();
      });
    };

    if (document.fonts?.status === "loaded") paint();
    else void document.fonts?.ready.then(schedule, schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(wrap);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [chart, fontSymbols, fontUi, palette, renderSnapshot, updateHoverFromClientPoint, wheelRenderStyle]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPointerClientRef.current = { x: event.clientX, y: event.clientY };
    updateHoverFromClientPoint(event.clientX, event.clientY);
  };

  const handlePointerLeave = () => {
    lastPointerClientRef.current = null;
    hoveredKeyRef.current = null;
    setHoveredRegion(null);
    setTrackedFlagAnchor(null);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!inspectorOpen) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const hit = findMultiwheelHitRegion(
      hitRegionsRef.current,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    setInspectorActiveRegion(hit ? multiwheelHitToHover(hit) : null);
  };

  const canvas = (
    <div
      ref={wrapRef}
      className={cn(
        className ?? "relative flex h-full w-full flex-1 items-center justify-center",
        paintEffectsActive && "aries-chart-paint-effects",
        "select-none",
      )}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block" />
      <ChartHoverFlag anchor={flagAnchor} chart={chart} />
    </div>
  );
  return appControlsEnabled
    ? <ChartContextMenu chart={chart}>{canvas}</ChartContextMenu>
    : canvas;
}
