"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ChartContextMenu } from "@/components/workshell/chart-context-menu";
import { ChartHoverFlag, type FlagAnchor } from "@/components/workshell/chart-hover-flag";
import { CanvasDraw } from "@/lib/chart/canvas-draw";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import { createWheelRenderStyle } from "@/lib/chart/wheel-render-style";
import {
  awaitFonts,
  chartFontsAreReady,
  computeHitRegions,
  drawSnapshotLayer,
  findHitRegion,
  type ChartHitRegion,
} from "@/lib/chart/draw-chart";
import { fetchDocumentSnapshot, patchOptions } from "@/lib/daemon/client";
import { readPaletteFromTheme } from "@/lib/chart/palette";
import { perfNow, recordChartPerf } from "@/lib/chart/perf";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { cn } from "@/lib/utils";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useThemeStore } from "@/stores/theme-store";
import { hoverRegionKey, useWorkspaceStore, type HoverRegion } from "@/stores/workspace-store";

type DirtyState = {
  geometry: boolean;
  dynamic: boolean;
  outerLabel: boolean;
};

type RetainedPaintTransform = {
  scale: number;
  x: number;
  y: number;
};

type ChartTargetRect = {
  x: number;
  y: number;
  side: number;
};

type RenderedCanvasState = {
  width: number;
  height: number;
  target: ChartTargetRect;
};

type MidbandHitRegion = Extract<ChartHitRegion, { kind: "midband_empty" }>;

const DEFERRED_OUTER_LABEL_DELAY_MS = 1;

function chartTargetRect(width: number, height: number): ChartTargetRect {
  const side = Math.max(1, Math.min(width, height));
  return {
    x: (width - side) / 2,
    y: (height - side) / 2,
    side,
  };
}

function sameHostSize(a: RenderedCanvasState, width: number, height: number): boolean {
  return Math.abs(a.width - width) < 0.5 && Math.abs(a.height - height) < 0.5;
}

function sameFlagAnchor(a: FlagAnchor | null, b: FlagAnchor | null): boolean {
  if (!a || !b) return a === b;
  return (
    hoverRegionKey(a.region) === hoverRegionKey(b.region) &&
    JSON.stringify(a.region) === JSON.stringify(b.region) &&
    a.token === b.token &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5
  );
}

function dirtyStateFromSnapshot(chart: ChartRenderSnapshot): DirtyState {
  const plan = chart.renderInvalidation;
  if (plan) {
    return {
      geometry: Boolean(plan.geometry),
      dynamic: Boolean(plan.dynamic),
      outerLabel: Boolean(plan.outerLabel),
    };
  }
  if (chart.overlayRenderMode === "step_fast") {
    return { geometry: true, dynamic: true, outerLabel: true };
  }
  return {
    geometry: true,
    dynamic: true,
    outerLabel: chart.overlayRenderMode === "full",
  };
}

function shouldDeferOuterLabel(chart: ChartRenderSnapshot) {
  return Boolean(
    chart.renderInvalidation?.deferredOuterLabel ?? chart.overlayRenderMode === "deferred",
  );
}

function hitToHover(hit: ChartHitRegion): HoverRegion {
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
      // Carry the inner/outer ring role so a biwheel/transit outer-ring body
      // resolves against the comparison chart, not the radix (the daemon's
      // _build_region swap, inspector_service.py:644). Dropping it here made
      // every hover flag report the radix planet (graphchart.py:2151).
      chartRole: hit.chartRole,
    };
  }
  if (hit.kind === "vertex") {
    // Vertex is its own region kind (graphchart.py:2879, CHART_OBJECT_VERTEX).
    // Without this branch the hover fell through to the sign-0 fallback below,
    // resolving the Vertex glyph to an "Aries" flag instead of "Vertex".
    return { kind: "vertex", longitude: hit.longitude, house: hit.house, chartRole: hit.chartRole };
  }
  if (hit.kind === "fortune") {
    return { kind: "fortune", longitude: hit.longitude, chartRole: hit.chartRole };
  }
  if (hit.kind === "syzygy") {
    return {
      kind: "syzygy",
      longitude: hit.longitude,
      house: hit.house,
      label: hit.label,
      chartRole: hit.chartRole,
    };
  }
  if (hit.kind === "angle") {
    return { kind: "angle", angleId: hit.angleId, longitude: hit.longitude, chartRole: hit.chartRole };
  }
  if (hit.kind === "house") {
    return { kind: "house", houseIndex: hit.houseIndex, longitude: hit.longitude };
  }
  if (hit.kind === "secondary_ring") {
    return {
      kind: "secondary_ring",
      family: hit.family,
      itemId: hit.itemId,
      label: hit.label,
      longitude: hit.longitude,
      chartRole: hit.chartRole,
      searchObjectId: hit.searchObjectId,
      segments: hit.segments,
    };
  }
  if (hit.kind === "aspect") {
    return {
      kind: "aspect",
      p1: hit.p1,
      p2: hit.p2,
      aspectType: hit.aspectType,
      scope: hit.scope,
    };
  }
  if (hit.kind === "sign") {
    return { kind: "sign", signIndex: hit.signIndex, longitude: hit.longitude };
  }
  // midband_empty has no inspector representation — it is handled directly in
  // the click path (hide-all toggle) and never reaches here.
  return { kind: "sign", signIndex: 0, longitude: 0 };
}

function clickPointKey(hit: Extract<ChartHitRegion, { kind: "secondary_ring" }>): string {
  const role = hit.chartRole ?? "primary";
  return `point:${role}:${hit.family}:${hit.itemId}:${hit.longitude.toFixed(6)}`;
}

function clickAspectBodyKey(hit: ChartHitRegion): string | null {
  if (hit.kind === "planet") {
    return `${hit.chartRole === "outer" ? "outer:" : ""}${hit.planetId}`;
  }
  if (hit.kind === "fortune") {
    return `${hit.chartRole === "outer" ? "outer:" : ""}fortune`;
  }
  if (hit.kind === "vertex") {
    return `${hit.chartRole === "outer" ? "outer:" : ""}vertex`;
  }
  if (hit.kind === "syzygy") {
    return `${hit.chartRole === "outer" ? "outer:" : ""}syzygy`;
  }
  if (hit.kind === "angle") {
    const angleId = hit.angleId === "dsc" ? "dc" : hit.angleId;
    return `${hit.chartRole === "outer" ? "outer:" : ""}${angleId}`;
  }
  if (hit.kind === "secondary_ring") return clickPointKey(hit);
  return null;
}

function findMidbandClickHit(
  regions: ChartHitRegion[],
  mouseX: number,
  mouseY: number,
): MidbandHitRegion | null {
  for (const region of regions) {
    if (region.kind !== "midband_empty") continue;
    const dx = mouseX - region.x;
    const dy = mouseY - region.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= region.rInner * region.rInner && distSq <= region.rOuter * region.rOuter) {
      return region;
    }
  }
  return null;
}

export function ChartCanvas({
  chart,
  className,
}: {
  chart: ChartRenderSnapshot;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<HTMLCanvasElement>(null);
  const dynamicRef = useRef<HTMLCanvasElement>(null);
  const outerLabelRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const deferTimerRef = useRef<number | null>(null);
  const resizeSettleTimerRef = useRef<number | null>(null);
  const renderedSizeRef = useRef<RenderedCanvasState | null>(null);
  const retainedPaintTransformRef = useRef<RetainedPaintTransform | null>(null);
  const hitRegionsRef = useRef<ChartHitRegion[]>([]);
  const hoveredKeyRef = useRef<string | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  // The hovered symbol + its canvas-local pixel centre, driving the on-chart
  // hover-flag overlay (chartinspector.build_flag_payload). The hit region's
  // (x, y) IS the region centre — the anchor wx computes in
  // _hover_flag_anchor_for_region (workspace_shell.py:5262).
  const [flagAnchor, setFlagAnchor] = useState<FlagAnchor | null>(null);
  const flagAnchorRef = useRef<FlagAnchor | null>(null);
  const flagAnchorTokenRef = useRef(0);
  const setHoveredRegion = useWorkspaceStore((s) => s.setHoveredRegion);
  const setInspectorActiveRegion = useWorkspaceStore((s) => s.setInspectorActiveRegion);
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  const selectedAspectBody = useWorkspaceStore((s) => s.selectedAspectBody);
  const hideAllAspects = useWorkspaceStore((s) => s.hideAllAspects);
  const toggleSelectedAspectBody = useWorkspaceStore((s) => s.toggleSelectedAspectBody);
  const toggleHideAllAspects = useWorkspaceStore((s) => s.toggleHideAllAspects);
  const clearAspectSelection = useWorkspaceStore((s) => s.clearAspectSelection);
  const pushCommandSnapshot = useDaemonWorkspaceStore((s) => s.pushCommandSnapshot);
  const theme = useThemeStore((s) => s.theme);
  const styleRevision = useStyleRevision();

  // Click-to-toggle is gated on the daemon's exclusiveOnClick flag (meaning is
  // daemon-owned). When OFF, clicks behave as today (hover/pin only).
  const exclusiveOnClick = Boolean(
    chart.clickAspectFlags?.exclusiveOnClick ?? chart.primaryChart.clickAspectFlags?.exclusiveOnClick,
  );

  const palette = useMemo(
    () => ({ ...readPaletteFromTheme(theme), ...(chart.primaryChart.palette ?? {}) }),
    [chart, theme],
  );
  const chartTextFont = morinusTextFontFromTokens(theme?.appTokens);
  const renderStyle = useMemo(
    () => createWheelRenderStyle({
      palette,
      revision: styleRevision,
      fontSymbols: '"AriesMorinus"',
      fontUi: chartTextFont,
    }),
    [palette, styleRevision, chartTextFont],
  );

  const setTrackedFlagAnchor = useCallback((next: FlagAnchor | null) => {
    flagAnchorRef.current = next;
    setFlagAnchor((current) => (sameFlagAnchor(current, next) ? current : next));
  }, []);

  const ensureGlobalAspectsVisible = useCallback((reason: string) => {
    if (chart.primaryChart.options.showAspects !== false) return;
    const docId = chart.document?.documentId;
    if (!docId) return;
    void patchOptions({ display: { aspects: true } })
      .then(() => fetchDocumentSnapshot(docId))
      .then((snapshot) => pushCommandSnapshot(docId, snapshot))
      .catch((err) => console.error(`[${reason}-show-aspects]`, err));
  }, [chart.document?.documentId, chart.primaryChart.options.showAspects, pushCommandSnapshot]);

  const mapRenderedPointToViewport = useCallback((rect: DOMRect, x: number, y: number): [number, number] => {
    const transform = retainedPaintTransformRef.current;
    if (!transform) {
      return [rect.left + x, rect.top + y];
    }
    return [
      rect.left + transform.x + x * transform.scale,
      rect.top + transform.y + y * transform.scale,
    ];
  }, []);

  const mapPointerToRenderedPoint = useCallback((x: number, y: number): [number, number] => {
    const transform = retainedPaintTransformRef.current;
    if (!transform) {
      return [x, y];
    }
    return [(x - transform.x) / transform.scale, (y - transform.y) / transform.scale];
  }, []);

  const updateHoverFromClientPoint = useCallback((clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      hoveredKeyRef.current = null;
      setHoveredRegion(null);
      setTrackedFlagAnchor(null);
      return;
    }
    const [x, y] = mapPointerToRenderedPoint(clientX - rect.left, clientY - rect.top);
    const hit = findHitRegion(hitRegionsRef.current, x, y);
    // midband_empty is a click target only — no hover/flag representation
    // (hitToHover falls through it). Treat it as no-hover for the flag.
    const flaggable = hit && hit.kind !== "midband_empty" ? hit : null;
    const nextHover = flaggable ? hitToHover(flaggable) : null;
    const nextKey = hoverRegionKey(nextHover);
    if (hoveredKeyRef.current === nextKey) return;
    hoveredKeyRef.current = nextKey;
    setHoveredRegion(nextHover);
    // Drive the hover-flag overlay, anchored to the symbol centre in viewport
    // coordinates. The flag portals to document.body so pane overflow cannot
    // clip it.
    if (flaggable && nextHover) {
      const [anchorX, anchorY] = mapRenderedPointToViewport(rect, flaggable.x, flaggable.y);
      flagAnchorTokenRef.current += 1;
      setTrackedFlagAnchor({
        region: nextHover,
        x: anchorX,
        y: anchorY,
        token: flagAnchorTokenRef.current,
      });
    } else {
      setTrackedFlagAnchor(null);
    }
  }, [mapPointerToRenderedPoint, mapRenderedPointToViewport, setHoveredRegion, setTrackedFlagAnchor]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const geometryCanvas = geometryRef.current;
    const dynamicCanvas = dynamicRef.current;
    const outerLabelCanvas = outerLabelRef.current;
    if (!wrap || !geometryCanvas || !dynamicCanvas || !outerLabelCanvas) {
      return;
    }

    let cancelled = false;
    const geometryDraw = new CanvasDraw(geometryCanvas);
    const dynamicDraw = new CanvasDraw(dynamicCanvas);
    const outerLabelDraw = new CanvasDraw(outerLabelCanvas);
    geometryDraw.setDefaultFont(chartTextFont);
    dynamicDraw.setDefaultFont(chartTextFont);
    outerLabelDraw.setDefaultFont(chartTextFont);

    const applyCanvasPaintRect = (
      canvas: HTMLCanvasElement,
      width: number,
      height: number,
      x = 0,
      y = 0,
      scale = 1,
    ) => {
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.right = "auto";
      canvas.style.bottom = "auto";
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.transformOrigin = "0 0";
      canvas.style.transform = scale === 1 && x === 0 && y === 0
        ? ""
        : `translate(${x}px, ${y}px) scale(${scale})`;
    };

    const paintCanvasesAtNaturalSize = (width: number, height: number) => {
      retainedPaintTransformRef.current = { x: 0, y: 0, scale: 1 };
      for (const canvas of [geometryCanvas, dynamicCanvas, outerLabelCanvas]) {
        applyCanvasPaintRect(canvas, width, height);
      }
    };

    const scaleRetainedCanvases = (target: ChartTargetRect) => {
      const rendered = renderedSizeRef.current;
      if (!rendered || rendered.width <= 0 || rendered.height <= 0 || rendered.target.side <= 0) {
        return;
      }
      // wx CentralChartHost maps the previous centered chart square into the
      // new centered chart square. The full canvas may be rectangular, but the
      // wheel target is never stretched independently on X/Y.
      const scale = target.side / rendered.target.side;
      const x = target.x - rendered.target.x * scale;
      const y = target.y - rendered.target.y * scale;
      retainedPaintTransformRef.current = {
        scale,
        x,
        y,
      };
      for (const canvas of [geometryCanvas, dynamicCanvas, outerLabelCanvas]) {
        applyCanvasPaintRect(canvas, rendered.width, rendered.height, x, y, scale);
      }
    };

    const render = (dirty: DirtyState): boolean => {
      if (cancelled) {
        return false;
      }
      const paintStartedAt = perfNow();
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const previous = renderedSizeRef.current;
      const effectiveDirty =
        previous && !sameHostSize(previous, rect.width, rect.height)
          ? { geometry: true, dynamic: true, outerLabel: true }
          : dirty;
      const target = chartTargetRect(rect.width, rect.height);
      renderedSizeRef.current = { width: rect.width, height: rect.height, target };
      paintCanvasesAtNaturalSize(rect.width, rect.height);
      let geometryMs = 0;
      let dynamicMs = 0;
      let outerLabelMs = 0;
      if (effectiveDirty.geometry) {
        const layerStartedAt = perfNow();
        geometryDraw.resize(rect.width, rect.height);
        drawSnapshotLayer(geometryDraw, chart, "geometry", {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          renderStyle,
        });
        geometryMs = perfNow() - layerStartedAt;
      }
      if (effectiveDirty.dynamic) {
        const layerStartedAt = perfNow();
        dynamicDraw.resize(rect.width, rect.height);
        drawSnapshotLayer(dynamicDraw, chart, "dynamic", {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          renderStyle,
          // Click-to-toggle selection (UI state). Gated inside draw-chart on the
          // chart's clickAspectFlags.exclusiveOnClick — ignored when OFF.
          clickAspectState: { selectedBody: selectedAspectBody, hideAll: hideAllAspects },
        });
        dynamicMs = perfNow() - layerStartedAt;
      }
      if (effectiveDirty.outerLabel) {
        const layerStartedAt = perfNow();
        outerLabelDraw.resize(rect.width, rect.height);
        drawSnapshotLayer(outerLabelDraw, chart, "outer-label", {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          renderStyle,
        });
        outerLabelMs = perfNow() - layerStartedAt;
      }
      const hitStartedAt = perfNow();
      hitRegionsRef.current = computeHitRegions(chart, {
        width: rect.width,
        height: rect.height,
        chartSize: target.side,
        renderStyle,
        textsize: (text, textOpts) => outerLabelDraw.textsize(text, textOpts),
        clickAspectState: { selectedBody: selectedAspectBody, hideAll: hideAllAspects },
      });
      const trackedFlag = flagAnchorRef.current;
      const trackedKey = hoverRegionKey(trackedFlag?.region ?? null);
      let flagReanchored = false;
      if (trackedFlag && trackedKey) {
        const refreshedHit = hitRegionsRef.current.find((candidate) => {
          if (candidate.kind === "midband_empty") return false;
          return hoverRegionKey(hitToHover(candidate)) === trackedKey;
        });
        if (refreshedHit) {
          const refreshedRegion = hitToHover(refreshedHit);
          const [anchorX, anchorY] = mapRenderedPointToViewport(rect, refreshedHit.x, refreshedHit.y);
          const refreshedAnchor = {
            region: refreshedRegion,
            x: anchorX,
            y: anchorY,
            token: trackedFlag.token,
          };
          hoveredKeyRef.current = hoverRegionKey(refreshedRegion);
          setHoveredRegion(refreshedRegion);
          setTrackedFlagAnchor(refreshedAnchor);
          flagReanchored = true;
      } else {
          hoveredKeyRef.current = null;
          setHoveredRegion(null);
          setTrackedFlagAnchor(null);
        }
      }
      // Re-resolve hover from the last pointer position only when no tracked
      // flag was re-anchored above. During keyboard time-stepping the pointer
      // is stationary and usually no longer over the moved glyph, so this pass
      // would immediately clear or retarget the flag the persistence block just
      // carried across the repaint. Real pointer movement still wins — every
      // pointermove re-resolves — and repaints with no tracked flag (zoom or
      // resize under a static cursor) keep the refresh.
      const lastPointer = lastPointerClientRef.current;
      if (lastPointer && !flagReanchored) {
        updateHoverFromClientPoint(lastPointer.x, lastPointer.y);
      }
      const hitMs = perfNow() - hitStartedAt;
      const totalMs = perfNow() - paintStartedAt;
      recordChartPerf("chart-canvas-paint", {
        docId: chart.document?.documentId ?? null,
        mode: chart.overlayRenderMode,
        dirty: effectiveDirty,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        chartSize: Math.round(target.side),
        geometryMs,
        dynamicMs,
        outerLabelMs,
        hitMs,
        totalMs,
        hitRegions: hitRegionsRef.current.length,
      });
      return true;
    };

    const schedule = (dirty: DirtyState, afterPaint?: () => void) => {
      if (cancelled) {
        return;
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const painted = render(dirty);
        if (painted && !cancelled) {
          afterPaint?.();
        }
      });
    };

    const dirty = dirtyStateFromSnapshot(chart);

    const drawInitial = (immediate = false) => {
      if (deferTimerRef.current != null) {
        window.clearTimeout(deferTimerRef.current);
        deferTimerRef.current = null;
      }
      const queueDeferredOuterLabel = () => {
        if (!shouldDeferOuterLabel(chart)) {
          return;
        }
        deferTimerRef.current = window.setTimeout(() => {
          deferTimerRef.current = null;
          schedule({ geometry: false, dynamic: false, outerLabel: true });
        }, DEFERRED_OUTER_LABEL_DELAY_MS);
      };
      if (immediate) {
        const painted = render(dirty);
        if (painted && !cancelled) {
          queueDeferredOuterLabel();
        }
        return;
      }
      schedule(dirty, queueDeferredOuterLabel);
    };

    const fontWaitStartedAt = perfNow();
    const fontsAlreadyReady = chartFontsAreReady(chartTextFont);
    if (fontsAlreadyReady) {
      recordChartPerf("chart-font-wait", {
        docId: chart.document?.documentId ?? null,
        alreadyReady: true,
        waitMs: 0,
      });
      drawInitial(true);
    } else {
      awaitFonts(chartTextFont)
        .then(() => {
          recordChartPerf("chart-font-wait", {
            docId: chart.document?.documentId ?? null,
            alreadyReady: fontsAlreadyReady,
            waitMs: perfNow() - fontWaitStartedAt,
          });
          drawInitial();
        })
        .catch(() => {
          recordChartPerf("chart-font-wait", {
            docId: chart.document?.documentId ?? null,
            alreadyReady: fontsAlreadyReady,
            failed: true,
            waitMs: perfNow() - fontWaitStartedAt,
          });
          drawInitial();
        });
    }

    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const rendered = renderedSizeRef.current;
      if (!rendered || sameHostSize(rendered, rect.width, rect.height)) {
        return;
      }
      scaleRetainedCanvases(chartTargetRect(rect.width, rect.height));
      if (resizeSettleTimerRef.current != null) {
        window.clearTimeout(resizeSettleTimerRef.current);
      }
      resizeSettleTimerRef.current = window.setTimeout(() => {
        schedule({ geometry: true, dynamic: true, outerLabel: true });
      }, 90);
    });
    ro.observe(wrap);

    return () => {
      cancelled = true;
      ro.disconnect();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (deferTimerRef.current != null) {
        window.clearTimeout(deferTimerRef.current);
      }
      if (resizeSettleTimerRef.current != null) {
        window.clearTimeout(resizeSettleTimerRef.current);
      }
    };
  }, [chart, chartTextFont, renderStyle, selectedAspectBody, hideAllAspects, setHoveredRegion, setTrackedFlagAnchor, mapRenderedPointToViewport, updateHoverFromClientPoint]);

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

  const clearFloatingFlagAfterAspectClick = () => {
    // wx clears the floating chart flag during the redraw that follows a
    // click-to-aspect selection (workspace_shell.set_bitmap/clear regions).
    // Keep the side inspector state, but do not leave the old flag hovering
    // over the freshly filtered aspect view.
    lastPointerClientRef.current = null;
    hoveredKeyRef.current = null;
    setTrackedFlagAnchor(null);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const [x, y] = mapPointerToRenderedPoint(event.clientX - rect.left, event.clientY - rect.top);
    const resolvedHit = findHitRegion(hitRegionsRef.current, x, y);
    const midbandHit = exclusiveOnClick ? findMidbandClickHit(hitRegionsRef.current, x, y) : null;
    const hit = midbandHit && (!resolvedHit || resolvedHit.kind === "sign") ? midbandHit : resolvedHit;

    // Click-to-toggle aspects — port of morin._on_chart_click_for_aspects
    // (morin.py:4243-4294). Only active when the daemon flag exclusiveOnClick
    // is set; otherwise fall through to the normal hover/pin behavior.
    if (exclusiveOnClick && hit) {
      const globalAspectsHidden = chart.primaryChart.options.showAspects === false;
      if (hit.kind === "midband_empty") {
        if (globalAspectsHidden) {
          clearFloatingFlagAfterAspectClick();
          clearAspectSelection();
          ensureGlobalAspectsVisible("midband-click");
          return;
        }
        // Empty inner band → hide ALL aspects (toggle). hide_all branch.
        clearFloatingFlagAfterAspectClick();
        toggleHideAllAspects();
        return;
      }
      // A target whose aspects we can force-show: planet, angle, Fortune, Vertex,
      // or a primary secondary-ring point. Same target again clears; different
      // target switches (morin.py:4250-4284).
      const bodyKey = clickAspectBodyKey(hit);
      if (bodyKey) {
        clearFloatingFlagAfterAspectClick();
        toggleSelectedAspectBody(bodyKey);
        ensureGlobalAspectsVisible("aspect-target-click");
        if (inspectorOpen) {
          setInspectorActiveRegion(hitToHover(hit));
        }
        return;
      }
      clearFloatingFlagAfterAspectClick();
      clearAspectSelection();
    }

    if (hit && hit.kind !== "midband_empty") {
      if (inspectorOpen) {
        setInspectorActiveRegion(hitToHover(hit));
      }
    } else if (inspectorOpen) {
      // Click in empty area clears the pin.
      setInspectorActiveRegion(null);
    }
  };

  // Right-click over the wheel opens the chart context menu (outer-ring mode,
  // display toggles, house system, chart launchers — all daemon-sourced).
  //
  // The wrap <div> below IS the base-ui context-menu trigger: ChartContextMenu
  // passes it through the trigger's `render` prop so base-ui MERGES its native
  // onContextMenu (cursor anchor + open) directly onto this element. That keeps
  // the right-click handler on the same surface that receives pointer/click,
  // instead of an extra wrapper div whose synthetic onContextMenu didn't fire
  // reliably over the <canvas> children (Next 16 / React 19 / base-ui 1.4.1).
  // base-ui merges (does not replace) handlers, so our onPointerMove /
  // onPointerLeave / onClick below continue to run for hover + pin as before.
  return (
    <ChartContextMenu chart={chart}>
      <div
        ref={wrapRef}
        className={cn(
          className ?? "relative flex h-full w-full flex-1 items-center justify-center",
          "select-none",
        )}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      >
        <canvas ref={geometryRef} className="absolute inset-0 block" />
        <canvas ref={dynamicRef} className="absolute inset-0 block" />
        <canvas ref={outerLabelRef} className="absolute inset-0 block" />
        {/* Hover-flag — the compact glyph card pinned to the hovered
            symbol (chartinspector.build_flag_payload, the second inspector entry
            point). Portaled to document.body so pane overflow cannot clip it;
            renders daemon JSON verbatim. */}
        <ChartHoverFlag anchor={flagAnchor} chart={chart} />
        {/* Corner labels (date/time, place/coords, house-system, overlay)
            are rendered by `workspace-content.tsx` as siblings to ChartCanvas —
            see CornerLines + OverlayCorner. Already chart-size-aware. */}
      </div>
    </ChartContextMenu>
  );
}
