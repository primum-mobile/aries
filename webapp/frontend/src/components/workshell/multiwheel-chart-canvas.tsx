// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChartContextMenu } from "./chart-context-menu";
import { ChartHoverFlag, type FlagAnchor } from "./chart-hover-flag";
import { multiwheelOuterScene, paintMultiwheelOuterRing } from "@/lib/chart/multiwheel-outer-ring";
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
  settingsColorPreviewChartToken,
  withSettingsColorPreview,
} from "@/lib/chart/palette";
import { acknowledgePaintedDocumentSnapshot } from "@/lib/chart/painted-snapshot-registry";
import { chartPerfEnabled, perfNow, recordChartPerf } from "@/lib/chart/perf";
import { overlayPerfState, semanticFrameSignature } from "@/lib/chart/overlay-perf-state";
import { sameCanvasRenderState } from "@/lib/chart/snapshot-render-equivalence";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import {
  projectWheelAuthoringStyle,
  resolveWheelScale,
  wheelTypographyProfileForTheme,
} from "@/lib/chart/wheel-render-style";
import { assembleWheelGeometryPreview, resolveWheelGeometryPresetStyle } from "@/lib/chart/wheel-geometry-preset";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";
import { cn } from "@/lib/utils";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { onCopyEditorRepaint } from "@/lib/i18n/copy-editor/copy-store";
import { useThemeStore } from "@/stores/theme-store";
import { useColorSettingsPreviewStore, withZodiacFieldOpacityPreview } from "@/stores/color-settings-preview-store";
import { hoverRegionKey, useWorkspaceStore, type HoverRegion } from "@/stores/workspace-store";

function multiwheelHitToHover(hit: MultiwheelHitRegion): HoverRegion {
  const identity = {
    viewDocumentId: hit.viewDocumentId, coordinateMode: hit.coordinateMode, coordinateRevision: hit.coordinateRevision,
    chartRole: hit.chartRole,
    ringIndex: hit.ringIndex,
  } as const;
  if (hit.kind === "secondary_ring") return {kind: "secondary_ring", itemId: hit.itemId, family: hit.family, label: hit.label, longitude: hit.longitude, searchObjectId: hit.searchObjectId, ...identity};
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
  const paintedRef = useRef<{snapshot: ChartRenderSnapshot; width: number; height: number; style: string} | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const flagAnchorRef = useRef<FlagAnchor | null>(null);
  const flagAnchorTokenRef = useRef(0);
  const [flagAnchor, setFlagAnchor] = useState<FlagAnchor | null>(null);
  const setHoveredRegion = useWorkspaceStore((state) => state.setHoveredRegion);
  const setInspectorActiveRegion = useWorkspaceStore((state) => state.setInspectorActiveRegion);
  const inspectorOpen = useFrameLayoutStore((state) => state.inspectorOpen);
  const appTheme = useThemeStore((state) => state.theme);
  const zodiacFieldOpacityPreview = useColorSettingsPreviewStore((state) => state.zodiacFieldOpacity);
  const settingsColorPreview = useColorSettingsPreviewStore((state) => (
    settingsColorPreviewChartToken(state.color) === "--morinus-table" ? null
      : settingsColorPreviewChartToken(state.color) ? state.color : null
  ));
  const geometryProfile = useChartStyleEditorStore((state) => state.geometryProfile);
  const geometryOverrides = useChartStyleEditorStore((state) => state.geometryOverrides);
  const syncedGeometryOverrides = useChartStyleEditorStore((state) => state.syncedGeometryOverrides);
  const wheelGeometryReceipts = useChartStyleEditorStore((state) => state.wheelGeometryReceipts);
  const wheelAppearanceBaseline = useChartStyleEditorStore(state => state.wheelAppearanceBaseline);
  const resolvedOverrides = useChartStyleEditorStore(state => state.resolvedOverrides);
  const semanticOverrides = useChartStyleEditorStore(state => state.semanticOverrides);
  const tokenMetadata = useChartStyleEditorStore(state => state.tokenMetadata);
  const liveAppThemePreview = useChartStyleEditorStore(state => state.liveAppThemePreview);
  const pendingWheelCompositions = useChartStyleEditorStore((state) => state.pendingWheelCompositions);
  const wheelContextSource = useChartStyleEditorStore((state) => state.wheelPresetState?.context?.sourceThemeName);
  const wheelContextRevision = useChartStyleEditorStore((state) => state.wheelPresetState?.revision ?? -1);
  const gestureActive = useChartStyleEditorStore((state) => state.gestureStart != null);
  const editorRevision = useChartStyleEditorStore((state) => state.revision);
  const theme = useMemo(
    () => withSettingsColorPreview(
      inheritAppTheme ? appTheme : null,
      inheritAppTheme ? settingsColorPreview : null,
    ),
    [appTheme, inheritAppTheme, settingsColorPreview],
  );
  const renderSnapshot = useMemo(
    () => withZodiacFieldOpacityPreview(
      applyProfileColorsToSnapshot(chart, theme),
      inheritAppTheme ? zodiacFieldOpacityPreview : null,
    ),
    [chart, theme, inheritAppTheme, zodiacFieldOpacityPreview],
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
    () => resolveWheelGeometryPresetStyle(
      (cssVar) => theme?.chartPalette?.[cssVar],
      {
        palette,
        revision: `${theme?.styleRevision ?? 0}:editor-${editorRevision}`,
        fontSymbols,
        fontUi,
      },
      {
        profile: wheelTypographyProfileForTheme(chart.primaryChart.options.theme),
        presets: chart.primaryChart.options.wheelGeometryPresets,
        readAppearanceValue: cssVar => theme?.chartPalette?.[cssVar] ?? theme?.appTokens?.[cssVar],
        appearanceOverrides: theme?.profileOverrides?.wheelAuthoring ?? {},
        preview: assembleWheelGeometryPreview({
          resolvedOverrides, semanticOverrides, tokenMetadata, wheelAppearanceBaseline, liveAppThemePreview,
          geometryProfile, geometryOverrides, syncedGeometryOverrides,
          wheelPresetState: {revision: wheelContextRevision, context: wheelContextSource ? {sourceThemeName: wheelContextSource} : undefined},
          wheelGeometryReceipts, pendingWheelCompositions,
          revision: editorRevision,
          gestureStart: gestureActive ? true : null,
        }),
      },
    ),
    [fontSymbols, fontUi, palette, theme, chart.primaryChart.options, geometryProfile, geometryOverrides, syncedGeometryOverrides, wheelGeometryReceipts,
      resolvedOverrides, semanticOverrides, tokenMetadata, wheelAppearanceBaseline, liveAppThemePreview,
      pendingWheelCompositions, wheelContextSource, wheelContextRevision, gestureActive, editorRevision],
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
      const perfEnabled = chartPerfEnabled();
      const bodyLayoutSignature = () => hitRegionsRef.current.filter(hit => hit.kind !== 'secondary_ring')
        .map(hit => `${hit.ringIndex}:${hit.kind}:${hit.kind === 'planet' ? hit.planetId : hit.kind === 'angle' ? hit.angleId : hit.kind}:${hit.x.toFixed(1)}:${hit.y.toFixed(1)}`).sort().join('|');
      const paintDetail = () => ({docId: chart.document?.documentId ?? null, mode: chart.overlayRenderMode,
        renderer: "multiwheel", overlay: perfEnabled ? overlayPerfState(renderSnapshot) : undefined,
        bodyLayoutSignature: perfEnabled ? bodyLayoutSignature() : undefined,
        semanticFrameSignature: perfEnabled ? semanticFrameSignature(renderSnapshot) : undefined,
        settleOverlayOnly: chart.settleOverlayOnly === true});
      const painted = paintedRef.current;
      if (chart.settleOverlayOnly && painted && painted.width === rect.width && painted.height === rect.height
          && painted.style === String(wheelRenderStyle.revision) && sameCanvasRenderState(painted.snapshot, renderSnapshot)) {
        acknowledgePaintedDocumentSnapshot(chart.document?.documentId, chart);
        recordChartPerf('chart-canvas-paint', {...paintDetail(), geometryMs: 0, dynamicMs: 0, fillMs: 0,
          outerLabelMs: 0, hitMs: 0, totalMs: 0, dynamicProfile: {'body-layout': {ms: 0}}});
        return;
      }
      const draw = new CanvasDraw(canvas);
      draw.resize(rect.width, rect.height);
      const title = document.querySelector<HTMLElement>("[data-aries-titlebar-title]");
      const titleRect = title?.getBoundingClientRect();
      const topBoundary = titleRect && titleRect.bottom > rect.top && titleRect.top < rect.bottom
        ? Math.max(0, Math.min(rect.height, titleRect.bottom - rect.top + 4))
        : 0;
      const availableHeight = Math.max(1, rect.height - topBoundary);
      const side = Math.min(rect.width, availableHeight);
      const profile = wheelTypographyProfileForTheme(renderSnapshot.primaryChart.options.theme);
      // The chart-wide preset scale applies to this renderer too. Its own
      // tri/quad body-band solver still owns individual ring thicknesses.
      let maxRadius = Math.max(80, side * 0.475 * resolveWheelScale(wheelRenderStyle, profile));
      const center: [number, number] = [
        rect.width / 2,
        topBoundary + availableHeight / 2,
      ];
      const outerOptions = {width: rect.width, height: rect.height, center, renderStyle: wheelRenderStyle};
      const requestedOuter = multiwheelOuterScene(renderSnapshot, outerOptions, maxRadius);
      if (requestedOuter) maxRadius = Math.max(80, maxRadius - Math.max(0, requestedOuter.scene.paintRadius - maxRadius));
      const rootOptions = rings[0].options;
      const layout = resolveMultiwheelLayout({
        maxRadius,
        ringCount: rings.length,
        ringZodiac: renderSnapshot.ringZodiac ?? "rim",
        bodiesPerRing: rings.map((ring) => ring.planets.length),
        showZodiac: rings[0].coordinateFrame?.showEquatorialSigns,
        showTerms: Boolean(rootOptions.showTerms && rootOptions.terms?.length),
        showDecans: Boolean(rootOptions.showDecans && rootOptions.decans?.length),
      });
      const projectedStyle = projectWheelAuthoringStyle(wheelRenderStyle, layout.maxRadius, profile);
      let bodyLayoutMs = 0;
      hitRegionsRef.current = drawMultiwheel(
        draw,
        center,
        layout,
        renderSnapshot,
        palette,
        { symbols: fontSymbols, ui: fontUi },
        { width: rect.width, height: rect.height, topBoundary },
        projectedStyle,
        perfEnabled ? ms => { bodyLayoutMs += ms; } : undefined,
      );
      hitRegionsRef.current.push(...paintMultiwheelOuterRing(draw,
        multiwheelOuterScene(renderSnapshot, outerOptions, layout.maxRadius)));
      const lastPointer = lastPointerClientRef.current;
      if (lastPointer) {
        updateHoverFromClientPoint(lastPointer.x, lastPointer.y);
      }
      acknowledgePaintedDocumentSnapshot(chart.document?.documentId, chart);
      paintedRef.current = {snapshot: renderSnapshot, width: rect.width, height: rect.height, style: String(wheelRenderStyle.revision)};
      recordChartPerf("chart-canvas-paint", {
        ...paintDetail(),
        dynamicProfile: {'body-layout': {ms: bodyLayoutMs}},
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
    const stopCopyEditorRepaint = onCopyEditorRepaint(schedule);
    return () => {
      cancelled = true;
      observer.disconnect();
      stopCopyEditorRepaint();
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
      data-aries-chart-document={chart.document?.documentId}
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
