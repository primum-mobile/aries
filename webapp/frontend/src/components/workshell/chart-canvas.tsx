// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import { pointAngle } from "@/lib/chart/chart-coordinates";
import { aspectViewState } from "@/lib/chart/aspect-view-state";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { ChartContextMenu } from "@/components/workshell/chart-context-menu";
import { ChartHoverFlag, type FlagAnchor } from "@/components/workshell/chart-hover-flag";
import { MultiwheelChartCanvas } from "@/components/workshell/multiwheel-chart-canvas";
import { CanvasDraw } from "@/lib/chart/canvas-draw";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import {
  resolveWheelOverlayMetrics,
  resolveWheelScale,
  wheelFillUsesSolarDirection,
  wheelTypographyProfileForTheme,
} from "@/lib/chart/wheel-render-style";
import { assembleWheelGeometryPreview, resolveWheelGeometryPresetStyle, resolveWheelPresetAuthoringOverrides, resolveWheelPresetSnapshot } from "@/lib/chart/wheel-geometry-preset";
import { isWheelGeometryKey } from "@/lib/chart/wheel-geometry-ownership";
import {
  variantAuthoredOverrideIds,
} from "@/lib/style-lab/wheel-authoring-adapter";
import {
  awaitFonts,
  chartFontsAreReady,
  computeHitRegions,
  drawSnapshotLayer,
  findHitRegion,
  resolveChartOuterPaintEnvelope,
  wheelGeometryInputForSnapshot,
  type ChartHitRegion,
  type OuterLabelCollisionBounds,
} from "@/lib/chart/draw-chart";
import { resolveChartPaintTarget, type WheelRimLimit, type WheelVerticalAlignment } from "@/lib/chart/outer-glyph-lane";
import { WheelFrameTuner } from "@/components/workshell/wheel-frame-tuner";
import { DESIGN_TUNERS_ENABLED, useDesignTunerStore } from "@/stores/design-tuner-store";
import { useWheelFrameTuneStore } from "@/stores/wheel-frame-tune-store";
import { fitModulesToCornerText, type DashboardCorners, type DashboardLayout } from "@/lib/chart/dashboard-layout";
import { cornerOuterLabelBounds, cssColorResolver, cssPixels, dashboardObstaclesKey, dashboardOuterLabelBounds, dashboardShown, dashboardTextObstacles, dashboardWheelTarget, measureCornerBoxes, solveDashboardSurface } from "@/lib/chart/dashboard-canvas";
import { measureScaleMetrics, paintDashboard, type DashObstacles } from "@/lib/chart/dashboard-paint";
import { dashboardContainsPoint, dashboardHitRegions } from "@/lib/chart/dashboard-hover";
import { useT } from "@/lib/i18n/i18n";
import { onCopyEditorRepaint } from "@/lib/i18n/copy-editor/copy-store";
import { executeWorkspaceContextMenuAction } from "@/lib/daemon/client";
import { runWorkspaceDocumentSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import type { ThemeState } from "@/lib/daemon/client";
import {
  applyProfileColorsToSnapshot,
  neutralChartPalette,
  readPaletteFromTheme,
  readPaletteProfileOverrides,
  settingsColorPreviewChartToken,
  withSettingsColorPreview,
} from "@/lib/chart/palette";
import {
  chartPerfEnabled,
  perfNow,
  recordChartPerf,
  speedlogEnabled,
} from "@/lib/chart/perf";
import { acknowledgePaintedDocumentSnapshot } from "@/lib/chart/painted-snapshot-registry";
import { overlayPerfState, semanticFrameSignature } from "@/lib/chart/overlay-perf-state";
import { notifyChartPainted } from "@/lib/chart/last-chart-preview";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { mobileLayoutMatches, useMobileLayout } from "@/hooks/use-mobile-layout";
import { STYLE_FONT_ASSETS_READY_EVENT } from "@/lib/style-lab/fonts";
import {
  WHEEL_STYLE_SCENE_ELEMENT_IDS,
  buildWheelStyleScene,
  hitTestWheelStyleScene,
  resolveWheelStyleHandleDrag,
  type WheelStyleScene,
  type StyleSceneTokenPatch,
} from "@/lib/style-lab/wheel-style-scene";
import {
  styleSceneClassId,
  type StyleSceneHandle,
  type StyleSceneHitGeometry,
  type StyleScenePoint,
} from "@/lib/style-lab/style-scene";
import {
  buildWheelClassTree,
  wheelClassFamilyByMember,
  wheelClassFamilyOwnerByMember,
} from "@/lib/style-lab/wheel-class-tree";
import { WHEEL_SEMANTIC_CLASS_IDS } from "@/lib/style-lab/semantic-class-manifest";
import { cn } from "@/lib/utils";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import {
  applyOverrideEdit,
  useChartStyleEditorStore,
  type ChartStyleCssOverrides,
  type ChartStyleSemanticOverrides,
} from "@/stores/chart-style-editor-store";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useThemeStore } from "@/stores/theme-store";
import { useColorSettingsPreviewStore, withZodiacFieldOpacityPreview, type SettingsColorPreview } from "@/stores/color-settings-preview-store";
import { hoverRegionKey, useWorkspaceStore, type HoverRegion } from "@/stores/workspace-store";

type DirtyState = {
  fill: boolean;
  geometry: boolean;
  dynamic: boolean;
  outerLabel: boolean;
};

function dirtyLayersForSettingsColor(
  preview: SettingsColorPreview | null,
  chart: ChartRenderSnapshot,
  theme: ThemeState | null,
): DirtyState {
  const none = { fill: false, geometry: false, dynamic: false, outerLabel: false };
  const token = settingsColorPreviewChartToken(preview);
  if (!preview || !token || token === "--morinus-table") return none;
  if (Object.values(theme?.profileOverrides.wheelColorRoleAliases ?? {}).includes(token)) {
    return { fill: true, geometry: true, dynamic: true, outerLabel: true };
  }
  switch (preview.attr) {
    case "clrindividual":
    case "clrperegrin":
    case "clrdomicil":
    case "clrexil":
    case "clrexal":
    case "clrcasus":
      return { ...none, dynamic: true, outerLabel: true };
    case "clraspect":
      return { ...none, dynamic: true };
    case "clrAscMC":
    case "clrhouses":
    case "clrhousenumbers":
      return { ...none, geometry: true, outerLabel: true };
    case "clrpositions":
      return { ...none, geometry: true, dynamic: true, outerLabel: true };
    case "clrsignelementfire":
    case "clrsignelementearth":
    case "clrsignelementair":
    case "clrsignelementwater":
      return {
        ...none,
        fill: true,
        geometry: true,
        dynamic: Boolean(chart.primaryChart.drishti?.length),
        outerLabel: true,
      };
    case "clrsigns":
      return { fill: true, geometry: true, dynamic: Boolean(chart.primaryChart.drishti?.length), outerLabel: true };
    default:
      return { fill: true, geometry: true, dynamic: true, outerLabel: true };
  }
}

type RetainedPaintTransform = {
  scale: number;
  x: number;
  y: number;
};

// What a handle drag paints before it is written: the editor maps the edit
// would produce, under a revision no stored edit can ever have.
type StyleDragPreview = Readonly<{
  revision: number;
  semanticOverrides: ChartStyleSemanticOverrides;
  resolvedOverrides: ChartStyleSemanticOverrides;
  cssOverrides: ChartStyleCssOverrides;
  geometryOverrides: ChartStyleSemanticOverrides;
}>;

type DraggedHandleView = Readonly<{
  id: string;
  radius: number;
  position: StyleScenePoint;
}>;

let styleDragPreviewSerial = 0;

function styleDragPreviewRevision(storeRevision: number): number {
  // Strictly between this stored revision and the next, and never repeated,
  // so render caches keyed by revision cannot confuse a frame with an edit.
  styleDragPreviewSerial += 1;
  return storeRevision + 1 - 1 / (styleDragPreviewSerial + 1);
}

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

// A fingertip covers far more than a mouse hotspot. Touch taps that land on a
// broad region (sign/term/decan band or the empty midband) look a short
// distance around the contact point for a specific target first.
const TOUCH_HIT_SLOP_CSS_PX = 16;
const BROAD_HIT_KINDS = new Set<ChartHitRegion["kind"]>(["sign", "term", "decan", "midband_empty"]);

function findTouchHitRegion(
  regions: ChartHitRegion[],
  x: number,
  y: number,
  slop: number,
): ChartHitRegion | null {
  const direct = findHitRegion(regions, x, y);
  if (direct && !BROAD_HIT_KINDS.has(direct.kind)) return direct;
  for (const radius of [slop / 2, slop]) {
    for (let step = 0; step < 8; step += 1) {
      const angle = (step * Math.PI) / 4;
      const hit = findHitRegion(regions, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      if (hit && !BROAD_HIT_KINDS.has(hit.kind)) return hit;
    }
  }
  return direct;
}

const DEFERRED_OUTER_LABEL_DELAY_MS = 1;
const TITLEBAR_OUTER_LABEL_CLEARANCE_PX = 6;
function scenePoint(
  center: StyleScenePoint,
  radius: number,
  longitude: number,
  ascendantDegrees: number,
): StyleScenePoint {
  const radians = (180 + longitude - ascendantDegrees) * (Math.PI / 180);
  return [
    center[0] + Math.cos(radians) * radius,
    center[1] - Math.sin(radians) * radius,
  ];
}

function polarSectorPath(
  geometry: Extract<StyleSceneHitGeometry, { kind: "polar-sector" }>,
): string {
  const startOuter = scenePoint(
    geometry.center,
    geometry.outerRadius,
    geometry.startLongitude,
    geometry.ascendantDegrees,
  );
  const endOuter = scenePoint(
    geometry.center,
    geometry.outerRadius,
    geometry.endLongitude,
    geometry.ascendantDegrees,
  );
  const endInner = scenePoint(
    geometry.center,
    geometry.innerRadius,
    geometry.endLongitude,
    geometry.ascendantDegrees,
  );
  const startInner = scenePoint(
    geometry.center,
    geometry.innerRadius,
    geometry.startLongitude,
    geometry.ascendantDegrees,
  );
  const span = ((geometry.endLongitude - geometry.startLongitude) % 360 + 360) % 360 || 360;
  const largeArc = span > 180 ? 1 : 0;
  return [
    `M ${startOuter[0]} ${startOuter[1]}`,
    `A ${geometry.outerRadius} ${geometry.outerRadius} 0 ${largeArc} 0 ${endOuter[0]} ${endOuter[1]}`,
    `L ${endInner[0]} ${endInner[1]}`,
    `A ${geometry.innerRadius} ${geometry.innerRadius} 0 ${largeArc} 1 ${startInner[0]} ${startInner[1]}`,
    "Z",
  ].join(" ");
}

function SceneGeometryStroke({
  geometry,
  className,
  strokeWidth,
  keyPrefix,
}: {
  geometry: StyleSceneHitGeometry;
  className: string;
  strokeWidth: number;
  keyPrefix: string;
}) {
  const common = {
    className: cn(
      className,
      "pointer-events-none fill-none [vector-effect:non-scaling-stroke]",
    ),
    fill: "none",
    strokeWidth,
  };
  if (geometry.kind === "compound") {
    return geometry.geometries.map((child, index) => (
      <SceneGeometryStroke
        key={`${keyPrefix}:${index}`}
        geometry={child}
        className={className}
        strokeWidth={strokeWidth}
        keyPrefix={`${keyPrefix}:${index}`}
      />
    ));
  }
  if (geometry.kind === "line") {
    return <line {...common} x1={geometry.start[0]} y1={geometry.start[1]} x2={geometry.end[0]} y2={geometry.end[1]} />;
  }
  if (geometry.kind === "rectangle") {
    return <rect {...common} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} rx={2} />;
  }
  if (geometry.kind === "circle") {
    return <circle {...common} fill="none" cx={geometry.center[0]} cy={geometry.center[1]} r={geometry.radius} />;
  }
  if (geometry.kind === "disc") {
    return <circle {...common} cx={geometry.center[0]} cy={geometry.center[1]} r={geometry.radius} />;
  }
  if (geometry.kind === "annulus") {
    return (
      <>
        <circle {...common} fill="none" cx={geometry.center[0]} cy={geometry.center[1]} r={geometry.innerRadius} />
        <circle {...common} fill="none" cx={geometry.center[0]} cy={geometry.center[1]} r={geometry.outerRadius} />
      </>
    );
  }
  return <path {...common} d={polarSectorPath(geometry)} />;
}

function SceneGeometryOutline({
  geometry,
  tone,
  keyPrefix,
}: {
  geometry: StyleSceneHitGeometry;
  tone: "hover" | "selected";
  keyPrefix: string;
}) {
  const selected = tone === "selected";
  // Selection chrome must not occupy the same visual channel as the property
  // being judged. Selection used to paint a 4px knockout halo in the
  // background colour under a solid 1.5px line, which buried a hairline chart
  // stroke under roughly five pixels of chrome — so a stroke width or colour
  // could not be seen while it was being edited, which is the one moment it
  // matters. Illustrator's model applies: hover asserts, selection recedes to
  // a hairline and lets the handles carry the state.
  if (selected) {
    return (
      <SceneGeometryStroke
        geometry={geometry}
        className="opacity-80 [stroke:var(--aries-style-lab-selection)] [stroke-dasharray:4_3]"
        strokeWidth={1}
        keyPrefix={`${keyPrefix}:outline`}
      />
    );
  }
  // Hover is transient and never coincides with editing, so it can afford the
  // contrast halo that makes a target unmistakable before it is clicked.
  return (
    <>
      <SceneGeometryStroke
        geometry={geometry}
        className="opacity-60 [stroke:var(--aries-background)]"
        strokeWidth={3}
        keyPrefix={`${keyPrefix}:halo`}
      />
      <SceneGeometryStroke
        geometry={geometry}
        className="opacity-70 [stroke:var(--aries-style-lab-selection)] [stroke-dasharray:3_2]"
        strokeWidth={1}
        keyPrefix={`${keyPrefix}:outline`}
      />
    </>
  );
}

function chartTargetRect(
  width: number,
  height: number,
  paintRadiusScale = 1,
  topBoundary = 0,
  avoidTitlebar = false,
  verticalAlignment: WheelVerticalAlignment = "center",
  targetScale = 1,
  rimLimit?: WheelRimLimit,
): ChartTargetRect {
  const target = resolveChartPaintTarget(
    width,
    height,
    paintRadiusScale,
    topBoundary,
    avoidTitlebar,
    verticalAlignment,
    targetScale,
    rimLimit,
  );
  return {
    x: (width - target.side) / 2,
    y: target.centerY - target.side / 2,
    side: target.side,
  };
}

// Phone: the chart pane starts below the title bar and scrolls the wheel
// under it, so the title never constrains the wheel (a scrolled wheel must
// keep its size and labels when it repaints).
function chartTitlebarCollisionBounds(
  hostRect: DOMRect,
): OuterLabelCollisionBounds | null {
  if (mobileLayoutMatches()) return null;
  const titlebar = document.querySelector<HTMLElement>(
    "[data-aries-titlebar-title]",
  );
  if (!titlebar) return null;
  const titleRect = titlebar.getBoundingClientRect();
  const clearance = TITLEBAR_OUTER_LABEL_CLEARANCE_PX;
  const bounds = {
    x: titleRect.left - hostRect.left - clearance,
    y: titleRect.top - hostRect.top - clearance,
    w: titleRect.width + clearance * 2,
    h: titleRect.height + clearance * 2,
  };
  if (
    titleRect.width <= 0
    || titleRect.height <= 0
    || bounds.x >= hostRect.width
    || bounds.y >= hostRect.height
    || bounds.x + bounds.w <= 0
    || bounds.y + bounds.h <= 0
  ) {
    return null;
  }
  return bounds;
}

function chartTitlebarTopBoundary(hostRect: DOMRect): number {
  if (mobileLayoutMatches()) return 0;
  const title = document.querySelector<HTMLElement>(
    "[data-aries-titlebar-title]",
  );
  if (!title) return 0;
  const titleRect = title.getBoundingClientRect();
  if (
    titleRect.width <= 0
    || titleRect.height <= 0
    || titleRect.left >= hostRect.right
    || titleRect.right <= hostRect.left
    || titleRect.bottom <= hostRect.top
    || titleRect.top >= hostRect.bottom
  ) {
    return 0;
  }
  return Math.min(
    hostRect.height,
    Math.max(
      0,
      titleRect.bottom - hostRect.top,
    ),
  );
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
  const traditional = chart.primaryChart.options.theme === 1
    && chart.primaryChart.options.wheelGeometryPresets?.compact?.overrides["wheel.presentation"] === "traditional-morinus";
  if (plan) {
    return {
      fill: chart.overlayRenderMode === "step_fast",
      geometry: Boolean(plan.geometry),
      dynamic: Boolean(plan.dynamic) || traditional,
      outerLabel: Boolean(plan.outerLabel),
    };
  }
  if (chart.overlayRenderMode === "step_fast") {
    return { fill: true, geometry: true, dynamic: true, outerLabel: true };
  }
  return {
    fill: false,
    geometry: true,
    dynamic: true,
    outerLabel: chart.overlayRenderMode === "full",
  };
}

function bodyLayoutSignature(regions: readonly ChartHitRegion[]): string {
  return regions
    .filter((region): region is Extract<
      ChartHitRegion,
      { kind: "planet" | "fortune" | "vertex" | "syzygy" | "eclipse" | "angle" }
    > =>
      region.kind === "planet" ||
        region.kind === "fortune" ||
        region.kind === "vertex" ||
        region.kind === "syzygy" ||
        region.kind === "eclipse" ||
        region.kind === "angle",
    )
    .map((region) => {
      const role = region.chartRole ?? "primary";
      const id = region.kind === "planet"
        ? region.planetId
        : region.kind === "angle"
          ? region.angleId
          : region.kind;
      return `${role}:${region.kind}:${id}:${Math.round(region.x * 10) / 10}:${Math.round(region.y * 10) / 10}`;
    })
    .sort()
    .join("|");
}


function shouldDeferOuterLabel(chart: ChartRenderSnapshot) {
  return Boolean(
    chart.renderInvalidation?.deferredOuterLabel ?? chart.overlayRenderMode === "deferred",
  );
}

function hitToHover(hit: ChartHitRegion): HoverRegion | null {
  const region = hitToHoverObject(hit);
  return region ? {...region, viewDocumentId: hit.viewDocumentId,
    coordinateMode: hit.coordinateMode, coordinateRevision: hit.coordinateRevision} : null;
}

function hitToHoverObject(hit: ChartHitRegion): HoverRegion | null {
  if (hit.kind === "decan") {
    return { kind: "decan", signIndex: hit.signIndex, decanIndex: hit.decanIndex, rulerSeId: hit.rulerSeId, longitude: hit.longitude };
  }
  if (hit.kind === "term") {
    return { kind: "term", signIndex: hit.signIndex, rulerSeId: hit.rulerSeId, longitude: hit.longitude };
  }
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
  if (hit.kind === "eclipse") {
    return {
      kind: "eclipse",
      longitude: hit.longitude,
      house: hit.house,
      label: hit.label,
      chartRole: hit.chartRole,
    };
  }
  if (hit.kind === "angle") {
    return { kind: "angle", angleId: hit.angleId, longitude: hit.longitude, chartRole: hit.chartRole };
  }
  if (hit.kind === "cusp") {
    return { kind: "house", houseIndex: hit.houseIndex, longitude: hit.longitude, chartRole: hit.chartRole };
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
      method: hit.method,
      contactId: hit.contactId,
    };
  }
  if (hit.kind === "declination") {
    return { kind: "declination", seId: hit.seId, ...(hit.partner != null ? { partner: hit.partner } : {}) };
  }
  if (hit.kind === "drishti") {
    return {
      kind: "drishti",
      relationId: hit.relationId,
      method: hit.method,
    };
  }
  if (hit.kind === "sign") {
    return { kind: "sign", signIndex: hit.signIndex, longitude: hit.longitude };
  }
  // midband_empty has no inspector representation — it is handled directly in
  // the click path (hide-all toggle) and never reaches here. Never coerce an
  // unknown hit into an Aries-sign inspector request.
  return null;
}

function clickPointKey(hit: Extract<ChartHitRegion, { kind: "secondary_ring" }>): string {
  const role = hit.chartRole ?? "primary";
  return hit.aspectKey ?? `point:${role}:${hit.family}:${hit.itemId}:${hit.longitude.toFixed(6)}`;
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
  if (hit.kind === "eclipse") {
    return `${hit.chartRole === "outer" ? "outer:" : ""}eclipse`;
  }
  if (hit.kind === "angle") {
    const angleId = hit.angleId === "dsc" ? "dc" : hit.angleId;
    return `${hit.chartRole === "outer" ? "outer:" : ""}${angleId}`;
  }
  if (hit.kind === "cusp") {
    return `${hit.chartRole === "outer" ? "outer:" : ""}cusp${hit.houseIndex}`;
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

/**
 * Who owns a gesture opened by dragging a handle on the wheel.
 *
 * Distinct from the inspector's owner so a drag started while a numeric field
 * still has focus opens — or is refused — on its own terms, instead of silently
 * joining that field's transaction and committing it on release.
 */
const CANVAS_GESTURE_OWNER = "canvas" as const;

/** Class reading membership is fixed by the manifest. */
const WHEEL_CLASS_FAMILY_BY_MEMBER = wheelClassFamilyByMember(
  buildWheelClassTree(WHEEL_SEMANTIC_CLASS_IDS),
);

/**
 * Members whose reading is a single class rather than the sibling set.
 *
 * A degree ruler owns its ticks and carries their depth, so a click on a tick
 * reads as the ruler. Fanning out to the three tick groups instead would select
 * everything except the thing that sizes them.
 */
const WHEEL_CLASS_FAMILY_OWNER_BY_MEMBER = wheelClassFamilyOwnerByMember(
  buildWheelClassTree(WHEEL_SEMANTIC_CLASS_IDS),
);

export function ChartCanvas(props: {
  chart: ChartRenderSnapshot;
  className?: string;
  paintEffectsActive?: boolean;
  appControlsEnabled?: boolean;
  inheritAppTheme?: boolean;
  wheelVerticalAlignment?: WheelVerticalAlignment;
}) {
  if ((props.chart.rings?.length ?? 0) >= 3) {
    return <MultiwheelChartCanvas {...props} />;
  }
  return <WheelChartCanvas {...props} />;
}

function WheelChartCanvas({
  chart,
  className,
  paintEffectsActive,
  appControlsEnabled = true,
  inheritAppTheme = true,
  wheelVerticalAlignment = "center",
}: {
  chart: ChartRenderSnapshot;
  className?: string;
  paintEffectsActive?: boolean;
  appControlsEnabled?: boolean;
  inheritAppTheme?: boolean;
  wheelVerticalAlignment?: WheelVerticalAlignment;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<HTMLCanvasElement>(null);
  const dynamicRef = useRef<HTMLCanvasElement>(null);
  const outerLabelRef = useRef<HTMLCanvasElement>(null);
  const dashboardRef = useRef<HTMLCanvasElement>(null);
  const paintedDashboardRef = useRef<readonly unknown[] | null>(null);
  // Resolved module colours and rule widths for one theme scope. Stepping
  // repaints the modules with new data but the same theme, so it reuses them.
  const dashboardThemeScopeRef = useRef<{
    key: readonly unknown[];
    colors: Map<string, string>;
    widths: { rule: number; frame: number };
  } | null>(null);
  const dashboardLayoutRef = useRef<DashboardLayout | null>(null);
  const t = useT();
  // The wheel's largest size in its pane (WheelRimLimit); the design tuner moves it live.
  const frameTune = useWheelFrameTuneStore((state) => state.tune);
  const designTunerOpen = useDesignTunerStore((state) => state.open);
  const rafRef = useRef<number | null>(null);
  const deferTimerRef = useRef<number | null>(null);
  const resizeSettleTimerRef = useRef<number | null>(null);
  const renderedSizeRef = useRef<RenderedCanvasState | null>(null);
  const retainedPaintTransformRef = useRef<RetainedPaintTransform | null>(null);
  const renderedDocumentRef = useRef<string | null>(null);
  const paintedFillSignatureRef = useRef<string | null>(null);
  const paintedSolarFillSignatureRef = useRef<string | null>(null);
  const paintedRenderStyleRevisionRef = useRef<string | null>(null);
  const paintedChartRef = useRef<ChartRenderSnapshot | null>(null);
  const paintedSettingsColorRef = useRef<SettingsColorPreview | null>(null);
  const paintedAspectInteractionKeyRef = useRef<string | null>(null);
  const paintedStyleTargetModeRef = useRef<boolean | null>(null);
  const hitRegionsRef = useRef<ChartHitRegion[]>([]);
  const wheelRegionsRef = useRef<ChartHitRegion[]>([]);
  /** The plain wheel's painted corner text, measured on full paints (outer-label obstacles). */
  const plainCornersRef = useRef<DashboardCorners | null>(null);
  const styleSceneRef = useRef<WheelStyleScene | null>(null);
  const styleHandleDragRef = useRef<{
    handle: StyleSceneHandle;
    start: StyleScenePoint;
  } | null>(null);
  // A chart-scale drag is previewed by scaling the painted layers on the GPU.
  // The value is written once on release, so the drag repaints nothing and
  // wakes no editor state; the release paints the wheel once at its new size.
  const chartScalePreviewRef = useRef<{
    patch: StyleSceneTokenPatch;
    transform: RetainedPaintTransform;
  } | null>(null);
  const styleOverlayRef = useRef<SVGSVGElement>(null);
  // Every other handle drag paints from a local preview of its edit and is
  // written once on release: no store write, editor re-render, theme publish
  // or hit-scene rebuild per move.
  const styleHandlePatchRef = useRef<StyleSceneTokenPatch | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointerTypeRef = useRef<string>("mouse");
  // The hovered symbol + its canvas-local pixel centre, driving the on-chart
  // hover-flag overlay (chartinspector.build_flag_payload). The hit region's
  // (x, y) IS the region centre — the anchor wx computes in
  // _hover_flag_anchor_for_region (workspace_shell.py:5262).
  const [flagAnchor, setFlagAnchor] = useState<FlagAnchor | null>(null);
  const [fontAssetRevision, setFontAssetRevision] = useState(0);
  const [styleScene, setStyleScene] = useState<WheelStyleScene | null>(null);
  // A released chart-scale preview keeps its overlay transform until the
  // release paint publishes handles at the new size.
  useEffect(() => {
    if (!chartScalePreviewRef.current && styleOverlayRef.current) {
      styleOverlayRef.current.style.transform = "";
    }
  }, [styleScene]);

  const setPaintedLayerTransform = useCallback((transform: RetainedPaintTransform) => {
    const css = transform.scale === 1 && transform.x === 0 && transform.y === 0
      ? ""
      : `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    for (const canvas of [fillRef.current, geometryRef.current, dynamicRef.current, outerLabelRef.current]) {
      if (!canvas) continue;
      canvas.style.transformOrigin = "0 0";
      canvas.style.transform = css;
    }
  }, []);

  const previewChartScale = useCallback((patch: StyleSceneTokenPatch, handle: StyleSceneHandle) => {
    const startValue = handle.binding?.value ?? 0;
    if (!(startValue > 0) || handle.kind !== "radial") return;
    const ratio = patch.value / startValue;
    const [cx, cy] = handle.center;
    // Scale about the wheel centre, on top of any retained resize mapping.
    const base = retainedPaintTransformRef.current ?? { x: 0, y: 0, scale: 1 };
    const transform = {
      scale: base.scale * ratio,
      x: base.x + base.scale * cx * (1 - ratio),
      y: base.y + base.scale * cy * (1 - ratio),
    };
    chartScalePreviewRef.current = { patch, transform };
    setPaintedLayerTransform(transform);
    const overlay = styleOverlayRef.current;
    if (overlay) {
      overlay.style.transformOrigin = "0 0";
      overlay.style.transform = `translate(${cx * (1 - ratio)}px, ${cy * (1 - ratio)}px) scale(${ratio})`;
    }
  }, [setPaintedLayerTransform]);

  const clearChartScalePreview = useCallback(() => {
    chartScalePreviewRef.current = null;
    setPaintedLayerTransform(retainedPaintTransformRef.current ?? { x: 0, y: 0, scale: 1 });
    if (styleOverlayRef.current) styleOverlayRef.current.style.transform = "";
  }, [setPaintedLayerTransform]);

  const flagAnchorRef = useRef<FlagAnchor | null>(null);
  const flagAnchorTokenRef = useRef(0);
  const setHoveredRegion = useWorkspaceStore((s) => s.setHoveredRegion);
  const setInspectorActiveRegion = useWorkspaceStore((s) => s.setInspectorActiveRegion);
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  // Phone: the Inspector is a sheet the user opens after tapping, so a tap
  // pins its target even while the sheet is closed. Desktop pins only into an
  // open Inspector.
  const mobileLayout = useMobileLayout();
  const pinOnClick = inspectorOpen || mobileLayout;
  const selectedAspectBody = useWorkspaceStore((s) => aspectViewState(s, chart.document?.documentId).selectedAspectBody);
  const hideAllAspects = useWorkspaceStore((s) => aspectViewState(s, chart.document?.documentId).hideAllAspects);
  const minorOnlyAspects = useWorkspaceStore((s) => aspectViewState(s, chart.document?.documentId).minorOnlyAspects);
  const toggleSelectedAspectBody = useWorkspaceStore((s) => s.toggleSelectedAspectBody);
  const toggleHideAllAspects = useWorkspaceStore((s) => s.toggleHideAllAspects);
  const clearAspectSelection = useWorkspaceStore((s) => s.clearAspectSelection);
  const pushCommandSnapshot = useDaemonWorkspaceStore((s) => s.pushCommandSnapshot);
  const expectedWheelPresetRevision = useDaemonWorkspaceStore((s) => (
    s.lastOptionsChange && !s.lastOptionsChange.styleOnly
      ? s.lastOptionsChange.wheelPresetRevision
      : undefined
  ));
  const appTheme = useThemeStore((s) => s.theme);
  const zodiacFieldOpacityPreview = useColorSettingsPreviewStore((s) => s.zodiacFieldOpacity);
  const settingsColorPreview = useColorSettingsPreviewStore((s) => (
    settingsColorPreviewChartToken(s.color) === "--morinus-table" ? null
      : settingsColorPreviewChartToken(s.color) ? s.color : null
  ));
  const theme = inheritAppTheme ? appTheme : null;
  const styleEditorActive = useChartStyleEditorStore((s) => s.active);
  const styleWorkingPreviewActive = useChartStyleEditorStore(
    (s) => s.liveAppThemePreview,
  );
  const [styleDragPreview, setStyleDragPreview] = useState<StyleDragPreview | null>(null);
  const [draggedHandleView, setDraggedHandleView] = useState<DraggedHandleView | null>(null);
  const storeStyleEditorRevision = useChartStyleEditorStore((s) => s.revision);
  const storeStyleCssOverrides = useChartStyleEditorStore((s) => s.cssOverrides);
  const styleEditorRevision = styleDragPreview?.revision ?? storeStyleEditorRevision;
  const styleCssOverrides = styleDragPreview?.cssOverrides ?? storeStyleCssOverrides;
  const styleLabBaseTheme = useChartStyleEditorStore((s) => s.styleLabBaseTheme);
  // The resolved map, not the authored one: a class that follows a palette
  // role must reach the wheel as the colour it resolves to, never as the
  // reference itself.
  const storeStyleSemanticOverrides = useChartStyleEditorStore((s) => s.resolvedOverrides);
  const storeAuthoredOverrides = useChartStyleEditorStore(s => s.semanticOverrides);
  const authoredOverrides = styleDragPreview?.semanticOverrides ?? storeAuthoredOverrides;
  const styleSemanticOverrides = styleDragPreview?.resolvedOverrides ?? storeStyleSemanticOverrides;
  const geometryProfile = useChartStyleEditorStore((s) => s.geometryProfile);
  const storeGeometryOverrides = useChartStyleEditorStore((s) => s.geometryOverrides);
  const geometryOverrides = styleDragPreview?.geometryOverrides ?? storeGeometryOverrides;
  const syncedGeometryOverrides = useChartStyleEditorStore((s) => s.syncedGeometryOverrides);
  const wheelGeometryReceipts = useChartStyleEditorStore((s) => s.wheelGeometryReceipts);
  const wheelAppearanceBaseline = useChartStyleEditorStore(s => s.wheelAppearanceBaseline);
  const styleTokenMetadata = useChartStyleEditorStore(s => s.tokenMetadata);
  const pendingWheelCompositions = useChartStyleEditorStore((s) => s.pendingWheelCompositions);
  const wheelContextSource = useChartStyleEditorStore((s) => s.wheelPresetState?.context?.sourceThemeName);
  const wheelContextRevision = useChartStyleEditorStore((s) => s.wheelPresetState?.revision ?? -1);
  const styleAuthoringEditScope = useChartStyleEditorStore((s) => s.authoringEditScope);
  const selectedStyleElement = useChartStyleEditorStore((s) => s.selectedElement);
  // Non-null only while a value is actively being changed. For colour
  // changes the selection highlight disappears: during the moment of judgement the
  // chrome must not sit on the thing being judged.
  const styleGestureActive = useChartStyleEditorStore((s) => s.gestureStart != null);
  const hoveredStyleElement = useChartStyleEditorStore((s) => s.hoveredElement);
  const setHoveredStyleElement = useChartStyleEditorStore((s) => s.setHoveredElement);
  const selectStyleElement = useChartStyleEditorStore((s) => s.selectElement);
  const selectStyleFamily = useChartStyleEditorStore((s) => s.selectFamily);
  const clearStyleSelection = useChartStyleEditorStore((s) => s.clearSelection);
  const beginStyleGesture = useChartStyleEditorStore((s) => s.beginGesture);
  const setStyleOverride = useChartStyleEditorStore((s) => s.setOverride);
  const endStyleGesture = useChartStyleEditorStore((s) => s.endGesture);
  const cancelStyleGesture = useChartStyleEditorStore((s) => s.cancelGesture);
  const styleRevision = useStyleRevision();
  const hasProfilePaintEffects = Object.keys(theme?.profileOverrides?.chartPalette ?? {}).some(
    (name) => name.includes("wheel-effect-"),
  );
  const hasDraftPaintEffects = styleWorkingPreviewActive && Object.keys(styleCssOverrides).some(
    (name) => name.includes("wheel-effect-"),
  );
  const styleEditorCanvasStyle = useMemo(() => {
    if (!styleWorkingPreviewActive) return undefined;
    const effectVariables = Object.fromEntries(
      Object.entries(styleCssOverrides).filter(([name]) => name.includes("wheel-effect-")),
    );
    return {
      ...(styleEditorActive ? { touchAction: "none" } : {}),
      ...effectVariables,
    } as CSSProperties;
  }, [styleCssOverrides, styleEditorActive, styleWorkingPreviewActive]);

  const isolatedStyleLabTheme = useMemo<ThemeState | null>(() => {
    if (inheritAppTheme) return null;
    const appTokens = {
      ...styleLabBaseTheme.appTokens,
      ...styleCssOverrides,
    };
    const chartPalette = {
      ...styleLabBaseTheme.chartPalette,
      ...styleCssOverrides,
    };
    return {
      activePreset: styleLabBaseTheme.sourceThemeName ?? "style-lab",
      mode: styleLabBaseTheme.mode,
      schemaVersion: 1,
      version: 1,
      styleRevision: styleEditorRevision,
      paletteHash: "style-lab",
      styleHash: `style-lab-${styleEditorRevision}`,
      appTokens,
      chartPalette,
      activeProfile: null,
      profileOverrides: {
        appTokens,
        chartPalette,
        chartData: styleLabBaseTheme.chartData,
        wheelAuthoring: {},
        appAuthoring: styleLabBaseTheme.appAuthoring,
      },
    };
  }, [inheritAppTheme, styleCssOverrides, styleEditorRevision, styleLabBaseTheme]);

  // Click-to-toggle is gated on the daemon's exclusiveOnClick flag (meaning is
  // daemon-owned). When OFF, clicks behave as today (hover/pin only).
  const exclusiveOnClick = Boolean(
    chart.clickAspectFlags?.exclusiveOnClick ?? chart.primaryChart.clickAspectFlags?.exclusiveOnClick,
  );
  const aspectInteractionPaintKey = JSON.stringify([
    chart.document?.documentId ?? null,
    exclusiveOnClick,
    selectedAspectBody,
    hideAllAspects,
    minorOnlyAspects,
  ]);

  const candidateTheme = useMemo(() => {
    if (!inheritAppTheme) return isolatedStyleLabTheme;
    if (!styleWorkingPreviewActive || !theme || !Object.keys(styleCssOverrides).length) return theme;
    return {
      ...theme,
      appTokens: { ...theme.appTokens, ...styleCssOverrides },
      chartPalette: { ...theme.chartPalette, ...styleCssOverrides },
      profileOverrides: {
        ...theme.profileOverrides,
        appTokens: { ...theme.profileOverrides.appTokens, ...styleCssOverrides },
        chartPalette: {
          ...theme.profileOverrides.chartPalette,
          ...styleCssOverrides,
        },
      },
    };
  }, [inheritAppTheme, isolatedStyleLabTheme, styleCssOverrides, styleWorkingPreviewActive, theme]);
  const snapshotWheelPresetRevision = useMemo(() => {
    const revisions = Object.values(chart.primaryChart.options.wheelGeometryPresets ?? {})
      .map((selection) => selection?.revision)
      .filter((revision): revision is number => typeof revision === "number");
    return revisions.length ? Math.max(...revisions) : null;
  }, [chart.primaryChart.options.wheelGeometryPresets]);
  const wheelThemeTransitionPending = Boolean(
    inheritAppTheme
    && !styleWorkingPreviewActive
    && expectedWheelPresetRevision != null
    && snapshotWheelPresetRevision != null
    && snapshotWheelPresetRevision < expectedWheelPresetRevision
  );
  // App chrome may adopt its new palette immediately, but the wheel is one
  // coherent frame: keep its previous theme until the snapshot carrying the
  // matching composition and radii arrives. This prevents a new font/style
  // from being laid out against the preceding theme's band geometry.
  const [settledTheme, setSettledTheme] = useState<ThemeState | null>(candidateTheme);
  // Adjusted during render (React's "store info from previous renders"
  // pattern). The comparison guard is mandatory: any render-phase setState —
  // even one whose updater returns the same value — forces a re-render, so an
  // unguarded call loops forever ("Too many re-renders").
  if (!wheelThemeTransitionPending && settledTheme !== candidateTheme) {
    setSettledTheme(candidateTheme);
  }
  const effectiveTheme = useMemo(
    () => withSettingsColorPreview(
      settledTheme,
      inheritAppTheme ? settingsColorPreview : null,
    ),
    [inheritAppTheme, settledTheme, settingsColorPreview],
  );

  // Each time step publishes a new chart object with the same daemon palette.
  // Key on the palette's content: a new palette object here re-resolves the
  // render style and misses every style-keyed paint cache on every step.
  const chartPaletteKey = JSON.stringify(chart.primaryChart.palette ?? null);
  const palette = useMemo(
    () => ({
      ...(inheritAppTheme ? readPaletteFromTheme(effectiveTheme) : neutralChartPalette()),
      ...(JSON.parse(chartPaletteKey) ?? {}),
      ...readPaletteProfileOverrides(effectiveTheme),
    }),
    [chartPaletteKey, effectiveTheme, inheritAppTheme],
  );
  const appearanceSnapshot = useMemo(
    () => withZodiacFieldOpacityPreview(
      applyProfileColorsToSnapshot(chart, effectiveTheme),
      inheritAppTheme ? zodiacFieldOpacityPreview : null,
    ),
    [chart, effectiveTheme, inheritAppTheme, zodiacFieldOpacityPreview],
  );
  useEffect(() => {
    if (zodiacFieldOpacityPreview !== null
      && chart.primaryChart.options.zodiacElementFieldOpacity === zodiacFieldOpacityPreview) {
      useColorSettingsPreviewStore.getState().setZodiacFieldOpacity(null);
    }
  }, [chart.primaryChart.options.zodiacElementFieldOpacity, zodiacFieldOpacityPreview]);
  const inheritedChartTextFont = morinusTextFontFromTokens(effectiveTheme?.appTokens);
  const wheelTextFont = effectiveTheme?.chartPalette?.["--aries-wheel-font-text"]?.trim();
  const chartTextFont = wheelTextFont && !wheelTextFont.startsWith("var(")
    ? wheelTextFont
    : inheritedChartTextFont;
  const inheritedChartSymbolFont =
    effectiveTheme?.appTokens?.["--aries-font-symbols"]?.trim() || '"AriesMorinus"';
  const wheelSymbolFont = effectiveTheme?.chartPalette?.["--aries-wheel-font-symbols"]?.trim();
  const chartSymbolFont = wheelSymbolFont && !wheelSymbolFont.startsWith("var(")
    ? wheelSymbolFont
    : inheritedChartSymbolFont;
  const resolveRoleFont = (cssVar: string, fallback: string) => {
    const value = effectiveTheme?.chartPalette?.[cssVar]?.trim();
    return value && !value.startsWith("var(") ? value : fallback;
  };
  const chartBodySymbolFont = resolveRoleFont(
    "--aries-wheel-font-body-symbols",
    chartSymbolFont,
  );
  const chartSignSymbolFont = resolveRoleFont(
    "--aries-wheel-font-sign-symbols",
    chartSymbolFont,
  );
  const chartTermSymbolFont = resolveRoleFont(
    "--aries-wheel-font-term-symbols",
    chartSymbolFont,
  );
  const chartDecanSymbolFont = resolveRoleFont(
    "--aries-wheel-font-decan-symbols",
    chartSymbolFont,
  );
  const chartAspectSymbolFont = resolveRoleFont(
    "--aries-wheel-font-aspect-symbols",
    chartSymbolFont,
  );
  // Stepped snapshots carry an equal but new presets object; key on content
  // so the render style survives time steps (see chartPaletteKey).
  const wheelGeometryPresetsKey = JSON.stringify(chart.primaryChart.options.wheelGeometryPresets ?? null);
  const wheelPresetInput = useMemo(
    () => ({
      profile: wheelTypographyProfileForTheme(chart.primaryChart.options.theme),
      presets: JSON.parse(wheelGeometryPresetsKey) ?? undefined,
      readAppearanceValue: (cssVar: string) => (styleWorkingPreviewActive ? styleCssOverrides[cssVar] : undefined)
        ?? effectiveTheme?.chartPalette?.[cssVar] ?? effectiveTheme?.appTokens?.[cssVar],
      appearanceOverrides: {
        ...(effectiveTheme?.profileOverrides?.wheelAuthoring ?? {}),
        ...(styleWorkingPreviewActive ? styleSemanticOverrides : {}),
      },
      preview: assembleWheelGeometryPreview({
        semanticOverrides: authoredOverrides,
        resolvedOverrides: styleSemanticOverrides, tokenMetadata: styleTokenMetadata, wheelAppearanceBaseline,
        liveAppThemePreview: styleWorkingPreviewActive,
        geometryProfile, geometryOverrides, syncedGeometryOverrides,
        wheelPresetState: {revision: wheelContextRevision, context: wheelContextSource ? {sourceThemeName: wheelContextSource} : undefined},
        wheelGeometryReceipts, pendingWheelCompositions,
        revision: styleEditorRevision,
        gestureStart: styleGestureActive ? true : null,
      }),
    }),
    [
      chart.primaryChart.options.theme,
      wheelGeometryPresetsKey,
      effectiveTheme?.profileOverrides?.wheelAuthoring,
      effectiveTheme?.chartPalette,
      effectiveTheme?.appTokens,
      styleCssOverrides,
      styleWorkingPreviewActive,
      styleSemanticOverrides,
      authoredOverrides,
      styleTokenMetadata,
      wheelAppearanceBaseline,
      geometryProfile,
      geometryOverrides,
      syncedGeometryOverrides,
      wheelGeometryReceipts,
      pendingWheelCompositions,
      wheelContextSource,
      wheelContextRevision,
      styleGestureActive,
      styleEditorRevision,
    ],
  );
  const effectiveWheelAuthoringOverrides = useMemo(
    () => resolveWheelPresetAuthoringOverrides(wheelPresetInput),
    [wheelPresetInput],
  );
  const renderSnapshot = useMemo(
    () => resolveWheelPresetSnapshot(appearanceSnapshot, wheelPresetInput),
    [appearanceSnapshot, wheelPresetInput],
  );

  useEffect(() => {
    const handleReady = () => setFontAssetRevision((value) => value + 1);
    document.addEventListener(STYLE_FONT_ASSETS_READY_EVENT, handleReady);
    return () => document.removeEventListener(STYLE_FONT_ASSETS_READY_EVENT, handleReady);
  }, []);

  useEffect(() => {
    if (!styleEditorActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const state = useChartStyleEditorStore.getState();
      if (state.gestureStart) {
        styleHandleDragRef.current = null;
        styleHandlePatchRef.current = null;
        setStyleDragPreview(null);
        setDraggedHandleView(null);
        clearChartScalePreview();
        cancelStyleGesture(CANVAS_GESTURE_OWNER);
        event.preventDefault();
        return;
      }
      // With no edit in flight, Escape is the way back up the hierarchy — the
      // counterpart to the double-click that went down.
      if (state.selectedFamily || !state.selectedElement) return;
      const selectedClassId = state.selectedElement.appearanceClassId ?? styleSceneClassId(state.selectedElement);
      // A ruler is the reading its ticks belong to, so Escape from a tick
      // ascends to the ruler rather than to the tick sibling set.
      const owner = WHEEL_CLASS_FAMILY_OWNER_BY_MEMBER.get(selectedClassId);
      const ownerElement = owner
        ? styleSceneRef.current?.elements.find(
            (element) => styleSceneClassId(element) === owner,
          ) ?? null
        : null;
      if (ownerElement) {
        state.selectElement(ownerElement);
        event.preventDefault();
        return;
      }
      const family = WHEEL_CLASS_FAMILY_BY_MEMBER.get(selectedClassId);
      if (!family) return;
      state.selectFamily(state.selectedElement, family);
      event.preventDefault();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [cancelStyleGesture, clearChartScalePreview, styleEditorActive]);

  const renderStyle = useMemo(
    () =>
      resolveWheelGeometryPresetStyle(
        (cssVar) => styleWorkingPreviewActive
          ? styleCssOverrides[cssVar] ?? effectiveTheme?.chartPalette?.[cssVar]
          : effectiveTheme?.chartPalette?.[cssVar],
        {
          palette,
          revision: `${styleRevision}:editor-${styleEditorRevision}:fonts-${fontAssetRevision}`,
          fontSymbols: chartSymbolFont,
          fontBodySymbols: chartBodySymbolFont,
          fontSignSymbols: chartSignSymbolFont,
          fontTermSymbols: chartTermSymbolFont,
          fontDecanSymbols: chartDecanSymbolFont,
          fontAspectSymbols: chartAspectSymbolFont,
          fontUi: chartTextFont,
        },
        wheelPresetInput,
      ),
    [
      palette,
      styleRevision,
      styleEditorRevision,
      styleWorkingPreviewActive,
      styleCssOverrides,
      wheelPresetInput,
      chartTextFont,
      chartSymbolFont,
      chartBodySymbolFont,
      chartSignSymbolFont,
      chartTermSymbolFont,
      chartDecanSymbolFont,
      chartAspectSymbolFont,
      fontAssetRevision,
      effectiveTheme?.chartPalette,
    ],
  );
  const setTrackedFlagAnchor = useCallback((next: FlagAnchor | null) => {
    flagAnchorRef.current = next;
    setFlagAnchor((current) => (sameFlagAnchor(current, next) ? current : next));
  }, []);

  const ensureGlobalAspectsVisible = useCallback((reason: string) => {
    if (!appControlsEnabled) return;
    if (chart.primaryChart.options.showAspects !== false) return;
    const docId = chart.document?.documentId;
    if (!docId) return;
    void runWorkspaceDocumentSnapshotCommand(docId, () => executeWorkspaceContextMenuAction(
      "workspace.set_chart_presentation", {documentId: docId, patch: {displayOverrides: {drawAspects: true}}},
    )).then(({result, isLatest}) => {
      if (isLatest && result.snapshot) pushCommandSnapshot(docId, result.snapshot as unknown as ChartRenderSnapshot);
    })
      .catch((err) => console.error(`[${reason}-show-aspects]`, err));
  }, [appControlsEnabled, chart.document?.documentId, chart.primaryChart.options.showAspects, pushCommandSnapshot]);

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

  const touchHitSlop = useCallback((): number => {
    const transform = retainedPaintTransformRef.current;
    return TOUCH_HIT_SLOP_CSS_PX / (transform?.scale || 1);
  }, []);

  const updateHoverFromClientPoint = useCallback((clientX: number, clientY: number, touch = false) => {
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
    const hit = touch
      ? findTouchHitRegion(hitRegionsRef.current, x, y, touchHitSlop())
      : findHitRegion(hitRegionsRef.current, x, y);
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
  }, [mapPointerToRenderedPoint, mapRenderedPointToViewport, setHoveredRegion, setTrackedFlagAnchor, touchHitSlop]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const fillCanvas = fillRef.current;
    const geometryCanvas = geometryRef.current;
    const dynamicCanvas = dynamicRef.current;
    const outerLabelCanvas = outerLabelRef.current;
    const dashboardCanvas = dashboardRef.current;
    if (!wrap || !fillCanvas || !geometryCanvas || !dynamicCanvas || !outerLabelCanvas || !dashboardCanvas) {
      return;
    }

    const layoutDocumentId = chart.document?.documentId ?? null;
    if (renderedDocumentRef.current !== layoutDocumentId) {
      renderedSizeRef.current = null;
      hitRegionsRef.current = [];
      wheelRegionsRef.current = [];
      paintedFillSignatureRef.current = null;
      paintedSolarFillSignatureRef.current = null;
      paintedRenderStyleRevisionRef.current = null;
      renderedDocumentRef.current = layoutDocumentId;
    }

    let cancelled = false;
    // When the pending rAF paint was first requested; splits React work from
    // the wait for the next frame in the step trace.
    let paintScheduledAt: number | null = null;
    const fillDraw = new CanvasDraw(fillCanvas);
    const geometryDraw = new CanvasDraw(geometryCanvas);
    const dynamicDraw = new CanvasDraw(dynamicCanvas);
    const outerLabelDraw = new CanvasDraw(outerLabelCanvas);
    const dashboardDraw = new CanvasDraw(dashboardCanvas);
    fillDraw.setDefaultFont(chartTextFont);
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

    const paintCanvasesAtNaturalSize = (
      width: number,
      height: number,
      includeFill: boolean,
    ) => {
      const retainedTransform = retainedPaintTransformRef.current;
      const restoreRetainedFill = includeFill || (
        retainedTransform != null
        && (
          retainedTransform.scale !== 1
          || retainedTransform.x !== 0
          || retainedTransform.y !== 0
        )
      );
      retainedPaintTransformRef.current = { x: 0, y: 0, scale: 1 };
      for (const canvas of [geometryCanvas, dynamicCanvas, outerLabelCanvas]) {
        applyCanvasPaintRect(canvas, width, height);
      }
      if (restoreRetainedFill) {
        applyCanvasPaintRect(fillCanvas, width, height);
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
      for (const canvas of [fillCanvas, geometryCanvas, dynamicCanvas, outerLabelCanvas]) {
        applyCanvasPaintRect(canvas, rendered.width, rendered.height, x, y, scale);
      }
    };

    const primary = renderSnapshot.primaryChart;
    const outerPaintEnvelope = resolveChartOuterPaintEnvelope(
      renderSnapshot,
      renderStyle,
    );
    const fillProfile = wheelTypographyProfileForTheme(primary.options.theme);
    const fillSignature = [
      renderStyle.revision,
      renderStyle.palette.background,
      renderStyle.palette.frame,
      fillProfile,
      JSON.stringify(primary.options.wheelComposition ?? null),
      JSON.stringify(primary.coordinateFrame ?? null),
      Boolean(renderSnapshot.comparisonChart),
      Boolean(primary.options.showTerms),
      Boolean(primary.options.showDecans),
      Boolean(primary.options.showHouses),
      Boolean(primary.options.useZodiacElementFieldColors),
      primary.options.zodiacElementFieldOpacity ?? 0.2,
      primary.options.signColors?.join(",") ?? "",
      primary.options.showOuterHouseLines !== false,
      renderSnapshot.document?.compoundKind ?? "",
    ].join("|");
    // Solar direction is part of the fill identity. Live step frames repaint
    // the material canvas, and the matching settled frame can then retain it.
    const solarFillSignature =
      wheelFillUsesSolarDirection(renderStyle, fillProfile)
        ? String(pointAngle(primary.planets.find((planet) => planet.id === "sun")))
        : null;

    // Chart dashboard: modules are placed first and the wheel takes the
    // solver's circle instead of the centred square (lib/chart/dashboard-layout.ts).
    const dashboard = renderSnapshot.dashboard;
    type ResolvedTarget = {
      target: ChartTargetRect;
      dashboardLayout: DashboardLayout | null;
      corners?: DashboardCorners;
      inset?: number;
    };
    const resolveTarget = (rect: DOMRect): ResolvedTarget => {
      const centred = chartTargetRect(
        rect.width,
        rect.height,
        outerPaintEnvelope.paintRadiusScale,
        chartTitlebarTopBoundary(rect),
        outerPaintEnvelope.avoidTitlebar,
        wheelVerticalAlignment,
        outerPaintEnvelope.targetScale,
        // Phones keep the largest square the pane allows.
        mobileLayoutMatches()
          ? undefined
          : { rimRadiusScale: outerPaintEnvelope.rimRadiusScale, height: frameTune.height, width: frameTune.width },
      );
      if (!dashboardShown(dashboard) || mobileLayoutMatches()) {
        return { target: centred, dashboardLayout: null };
      }
      const titlebar = chartTitlebarCollisionBounds(rect);
      const inset = resolveWheelOverlayMetrics(renderStyle.overlays, { width: rect.width, height: rect.height }).edgeInset;
      // Wheel-first: the solver sees reserved corner areas from stable inputs,
      // never the measured corner text (which only clips and yields).
      const dashboardLayout = solveDashboardSurface(dashboard, rect, renderStyle.overlays, titlebar ? [titlebar] : []);
      const target = dashboardWheelTarget(dashboardLayout, outerPaintEnvelope);
      // One measurement pass: the painted corner text, for the Moon text's
      // obstacles and for the modules to yield to. Never fed back into the
      // wheel; corner text simply draws over the chart where it reaches it.
      const corners = measureCornerBoxes(wrap, rect);
      return { target: target ?? centred, dashboardLayout: fitModulesToCornerText(dashboardLayout, corners), corners, inset };
    };

    const paintDashboardLayer = (rect: DOMRect, dashboardLayout: DashboardLayout | null, obstacles?: DashObstacles) => {
      dashboardLayoutRef.current = dashboardLayout;
      // Without a dashboard the layer stays hidden and untouched: plain wheels
      // pay no paint or compositing for it on any step frame.
      if (!dashboardLayout || !dashboard) {
        if (paintedDashboardRef.current) {
          paintedDashboardRef.current = null;
          dashboardCanvas.style.display = "";
        }
        return;
      }
      // Module paint follows the daemon payload, the layout, the theme and the
      // language; anything else leaves the retained layer as it is. Obstacles
      // are rebuilt every render, so they compare by value.
      const inputs = [
        dashboard, dashboardLayout, dashboardObstaclesKey(obstacles), renderStyle, effectiveTheme, t,
        chartTextFont, chartSymbolFont, chartBodySymbolFont, chartAspectSymbolFont,
      ] as const;
      const painted = paintedDashboardRef.current;
      if (painted && inputs.every((value, index) => painted[index] === value)) return;
      paintedDashboardRef.current = inputs;
      dashboardCanvas.style.display = "block";
      dashboardDraw.resize(rect.width, rect.height);
      dashboardDraw.ctx.clearRect(0, 0, rect.width, rect.height);
      const scopeKey = [renderStyle, effectiveTheme] as const;
      let scope = dashboardThemeScopeRef.current;
      if (!scope || scope.key.some((value, index) => value !== scopeKey[index])) {
        scope = {
          key: scopeKey,
          colors: new Map(),
          widths: {
            rule: cssPixels(wrap, "--aries-chart-module-rule-width", 1),
            frame: cssPixels(wrap, "--aries-chart-module-frame-width", 2),
          },
        };
        dashboardThemeScopeRef.current = scope;
      }
      const resolver = cssColorResolver(wrap, scope.colors);
      try {
        paintDashboard(
          {
            ctx: dashboardDraw.ctx,
            dashboard,
            color: resolver.color,
            fonts: { ui: chartTextFont, symbols: chartSymbolFont, body: chartBodySymbolFont, aspect: chartAspectSymbolFont },
            t,
            obstacles,
          },
          dashboardLayout,
          scope.widths,
        );
      } finally {
        resolver.dispose();
      }
    };

    const render = (dirty: DirtyState): boolean => {
      if (cancelled) {
        return false;
      }
      const paintStartedAt = perfNow();
      const scheduledAt = paintScheduledAt ?? paintStartedAt;
      paintScheduledAt = null;
      const perfEnabled = chartPerfEnabled();
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        if ((perfEnabled || speedlogEnabled()) && chart.overlayRenderMode !== "full") {
          recordChartPerf("chart-canvas-paint-suppressed", {
            docId: chart.document?.documentId ?? null,
            mode: chart.overlayRenderMode,
            reason: "zero-size",
            displayDatetime: chart.document?.displayDatetime ?? chart.displayDatetime,
          });
        }
        return false;
      }
      const diagnosticWindow = window as Window & {
        __ARIES_CHART_PERF_SUPPRESS_NEXT_STEP_PAINT__?: boolean;
      };
      if (
        perfEnabled &&
        chart.overlayRenderMode === "step_fast" &&
        diagnosticWindow.__ARIES_CHART_PERF_SUPPRESS_NEXT_STEP_PAINT__ === true
      ) {
        diagnosticWindow.__ARIES_CHART_PERF_SUPPRESS_NEXT_STEP_PAINT__ = false;
        recordChartPerf("chart-canvas-paint-suppressed", {
          docId: chart.document?.documentId ?? null,
          mode: chart.overlayRenderMode,
          reason: "diagnostic-suppression",
          displayDatetime: chart.document?.displayDatetime ?? chart.displayDatetime,
          semanticFrameSignature: semanticFrameSignature(chart),
        });
        return false;
      }
      const previous = renderedSizeRef.current;
      const titlebarBounds = chartTitlebarCollisionBounds(rect);
      const { target, dashboardLayout, corners: dashboardCorners, inset: dashboardInset } = resolveTarget(rect);
      // A layout-only move must repaint every retained layer together, even
      // when the daemon snapshot only invalidates overlay facts.
      const effectiveDirty: DirtyState =
        !previous || !sameHostSize(previous, rect.width, rect.height)
          || previous.target.side !== target.side || previous.target.y !== target.y
          || previous.target.x !== target.x
          ? { fill: true, geometry: true, dynamic: true, outerLabel: true }
          : {
              ...dirty,
              fill:
                dirty.fill
                || paintedFillSignatureRef.current !== fillSignature
                || (
                  solarFillSignature != null
                  && paintedSolarFillSignatureRef.current !== solarFillSignature
                ),
            };
      // Corner text and the surface edges (plus, with the dashboard, its
      // modules and corner reservations) abbreviate outer word labels that
      // would cross them. The plain wheel measures its corner text only when
      // the outer-label layer repaints (deferred after stepping), so step
      // frames never read layout; the moving layer reuses the last boxes.
      if (!dashboardLayout && (effectiveDirty.outerLabel || !plainCornersRef.current)) {
        plainCornersRef.current = measureCornerBoxes(wrap, rect);
      }
      const outerLabelCollisionBounds: OuterLabelCollisionBounds[] = [
        ...(titlebarBounds ? [titlebarBounds] : []),
        ...(dashboardLayout
          ? dashboardOuterLabelBounds(dashboardLayout, rect, renderStyle.overlays, dashboardCorners)
          : cornerOuterLabelBounds(plainCornersRef.current, rect)),
      ];
      const wheelCenter: readonly [number, number] = [
        target.x + target.side / 2,
        target.y + target.side / 2,
      ];
      renderedSizeRef.current = { width: rect.width, height: rect.height, target };
      paintCanvasesAtNaturalSize(
        rect.width,
        rect.height,
      effectiveDirty.fill,
      );
      let fillMs = 0;
      let geometryMs = 0;
      let dynamicMs = 0;
      let outerLabelMs = 0;
      let dynamicProfile: ReturnType<CanvasDraw["endProfile"]> = null;
    if (effectiveDirty.fill) {
        const layerStartedAt = perfNow();
        fillDraw.resize(rect.width, rect.height);
        drawSnapshotLayer(fillDraw, renderSnapshot, "fill", {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          center: wheelCenter,
          renderStyle,
        });
        paintedFillSignatureRef.current = fillSignature;
        paintedSolarFillSignatureRef.current = solarFillSignature;
        fillMs = perfNow() - layerStartedAt;
      }
      if (effectiveDirty.geometry) {
        const layerStartedAt = perfNow();
        geometryDraw.resize(rect.width, rect.height);
        drawSnapshotLayer(geometryDraw, renderSnapshot, "geometry", {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          center: wheelCenter,
          renderStyle,
        geometryOwnsBackground: false,
        });
        geometryMs = perfNow() - layerStartedAt;
      }
      if (effectiveDirty.dynamic) {
        const layerStartedAt = perfNow();
        dynamicDraw.resize(rect.width, rect.height);
        if (perfEnabled) dynamicDraw.beginProfile();
        drawSnapshotLayer(dynamicDraw, renderSnapshot, "dynamic", {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          center: wheelCenter,
          renderStyle,
          // Click-to-toggle selection (UI state). Gated inside draw-chart on the
          // chart's clickAspectFlags.exclusiveOnClick — ignored when OFF.
          clickAspectState: {
            selectedBody: selectedAspectBody,
            hideAll: hideAllAspects,
            minorOnly: minorOnlyAspects,
          },
          outerLabelCollisionBounds,
        });
        dynamicProfile = dynamicDraw.endProfile();
        dynamicMs = perfNow() - layerStartedAt;
      }
      if (effectiveDirty.outerLabel) {
        const layerStartedAt = perfNow();
        outerLabelDraw.resize(rect.width, rect.height);
        drawSnapshotLayer(outerLabelDraw, renderSnapshot, "outer-label", {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          center: wheelCenter,
          renderStyle,
          outerLabelCollisionBounds,
        });
        outerLabelMs = perfNow() - layerStartedAt;
      }
      const hitStartedAt = perfNow();
      // Hit regions and the editable scene are for pointing, not for seeing:
      // a handle drag rebuilds them once, on the paint after release.
      const handleDragActive = styleHandleDragRef.current != null;
      const refreshHitRegions = !handleDragActive && (
        effectiveDirty.geometry
        || effectiveDirty.dynamic
        || effectiveDirty.outerLabel
        || paintedStyleTargetModeRef.current !== styleEditorActive
      );
      if (refreshHitRegions) {
        const wheelRegions = computeHitRegions(renderSnapshot, {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          center: wheelCenter,
          renderStyle,
          textsize: (text, textOpts) => outerLabelDraw.textsize(text, textOpts),
          textbounds: (text, textOpts) => outerLabelDraw.textbounds(text, textOpts),
          textcontour: (text, textOpts) => outerLabelDraw.textcontour(text, textOpts),
          clickAspectState: {
            selectedBody: selectedAspectBody,
            hideAll: hideAllAspects,
            minorOnly: minorOnlyAspects,
          },
          includeStyleTargets: styleEditorActive,
          outerLabelCollisionBounds,
        });
        wheelRegionsRef.current = wheelRegions;
        // Dashboard modules duplicate the wheel's hover zones on their own
        // painted geometry (same region kinds, same hover flag).
        hitRegionsRef.current = dashboardLayout && dashboard
          ? [...wheelRegions, ...dashboardHitRegions(
            dashboardLayout,
            dashboard,
            wheelRegions,
            new Map(renderSnapshot.primaryChart.planets.map((planet) => [planet.seId, planet.id])),
            measureScaleMetrics(dashboardDraw.ctx, { fonts: { ui: chartTextFont, symbols: chartSymbolFont, body: chartBodySymbolFont, aspect: chartAspectSymbolFont }, t, dashboard }, dashboardLayout.glyph),
          )]
          : wheelRegions;
        paintedAspectInteractionKeyRef.current = aspectInteractionPaintKey;
        paintedStyleTargetModeRef.current = styleEditorActive;
        if (styleEditorActive) {
          const primary = renderSnapshot.primaryChart;
          const profile = wheelTypographyProfileForTheme(primary.options.theme);
          const styleGeometryInput = {
              ...wheelGeometryInputForSnapshot(
                renderSnapshot,
                target.side / 2 * resolveWheelScale(renderStyle, profile),
              ),
          } as const;
          const nextStyleScene = buildWheelStyleScene({
            style: renderStyle,
            authoringScope: styleAuthoringEditScope === "base" ? "base" : profile,
            // Use the same theme-appearance + preset-geometry map as paint.
            variantAuthoredOverrideIds: variantAuthoredOverrideIds(
              effectiveWheelAuthoringOverrides,
              profile,
            ),
            geometry: styleGeometryInput,
            center: wheelCenter,
            viewport: { width: rect.width, height: rect.height },
            ascendantDegrees: primary.angles.asc,
            useIndividualBodyColors: Boolean(primary.options.useDignityColors),
            useZodiacElementColors: Boolean(primary.options.useZodiacElementColors),
            useZodiacElementFieldColors: Boolean(
              primary.options.useZodiacElementFieldColors
            ),
            signColors: primary.options.signColors,
            hitRegions: hitRegionsRef.current,
          });
          const editorState = useChartStyleEditorStore.getState();
          editorState.setSceneElements(nextStyleScene.elements);
          styleSceneRef.current = nextStyleScene;
          setStyleScene(nextStyleScene);
        } else {
          const editorState = useChartStyleEditorStore.getState();
          if (editorState.sceneElements.length > 0) {
            editorState.setSceneElements([]);
          }
          styleSceneRef.current = null;
          setStyleScene(null);
        }
        const trackedFlag = flagAnchorRef.current;
        const trackedKey = hoverRegionKey(trackedFlag?.region ?? null);
        let flagReanchored = false;
        if (trackedFlag && trackedKey) {
          // A body or aspect can have a zone on the wheel and on a dashboard
          // module: keep the flag on the zone nearest its current anchor.
          let refreshedHit: ChartHitRegion | null = null;
          let nearest = Infinity;
          for (const candidate of hitRegionsRef.current) {
            if (candidate.styleOnly || candidate.kind === "midband_empty") continue;
            if (hoverRegionKey(hitToHover(candidate)) !== trackedKey) continue;
            const [vx, vy] = mapRenderedPointToViewport(rect, candidate.x, candidate.y);
            const distance = Math.hypot(vx - trackedFlag.x, vy - trackedFlag.y);
            if (distance < nearest) {
              nearest = distance;
              refreshedHit = candidate;
            }
          }
          if (refreshedHit) {
            const refreshedRegion = hitToHover(refreshedHit);
            if (refreshedRegion) {
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
      }
      // Modules paint after the wheel's hit regions exist: the Moon text runs
      // past its box only up to the nearest painted object.
      paintDashboardLayer(
        rect,
        dashboardLayout,
        dashboardLayout && dashboardCorners
          ? dashboardTextObstacles(wheelRegionsRef.current, dashboardLayout, dashboardCorners, {
            width: rect.width,
            inset: dashboardInset ?? 0,
          })
          : undefined,
      );
      const hitMs = perfNow() - hitStartedAt;
      const totalMs = perfNow() - paintStartedAt;
      if (refreshHitRegions) {
        acknowledgePaintedDocumentSnapshot(chart.document?.documentId, chart);
        notifyChartPainted();
      }
      recordChartPerf("chart-canvas-paint", {
        docId: chart.document?.documentId ?? null,
        mode: chart.overlayRenderMode,
        displayDatetime: chart.document?.displayDatetime ?? chart.displayDatetime,
        showHouses: Boolean(chart.primaryChart.options.showHouses),
        settleOverlayOnly: chart.settleOverlayOnly === true,
        dirty: effectiveDirty,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        chartSize: Math.round(target.side),
        dashboard: Boolean(dashboardLayout),
        geometryMs,
        fillMs,
        dynamicMs,
        dynamicProfile,
        outerLabelMs,
        hitMs,
        totalMs,
        scheduledAt,
        hitRegions: hitRegionsRef.current.length,
        bodyLayoutSignature: perfEnabled
          ? bodyLayoutSignature(hitRegionsRef.current)
          : undefined,
        semanticFrameSignature: perfEnabled
          ? semanticFrameSignature(chart)
          : undefined,
        overlay: perfEnabled ? overlayPerfState(renderSnapshot) : undefined,
      });
      paintedRenderStyleRevisionRef.current = String(renderStyle.revision);
      paintedChartRef.current = chart;
      paintedSettingsColorRef.current = settingsColorPreview;
      return true;
    };

    const schedule = (dirty: DirtyState, afterPaint?: () => void) => {
      if (cancelled) {
        return;
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
      paintScheduledAt ??= perfNow();
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const painted = render(dirty);
        if (painted && !cancelled) {
          afterPaint?.();
        }
      });
    };

    const previewChanged = paintedSettingsColorRef.current !== settingsColorPreview;
    const dirty = previewChanged && paintedChartRef.current === chart
      ? { fill: false, geometry: false, dynamic: false, outerLabel: false }
      : dirtyStateFromSnapshot(chart);
    // A local view change moves the wheel even when a settled snapshot's plan is empty.
    if (paintedChartRef.current?.dashboard?.enabled !== chart.dashboard?.enabled) {
      Object.assign(dirty, { fill: true, geometry: true, dynamic: true, outerLabel: true });
    }
    // The snapshot plan covers daemon-owned chart-frame changes only. Style
    // Lab edits are synchronous local paint inputs and may affect any retained
    // layer (including glyph metrics and the editable hit scene), so a new
    // resolved style revision must reach every canvas in this paint rather than
    // waiting for a later snapshot, resize, or time step to dirty that layer.
    if (paintedRenderStyleRevisionRef.current !== String(renderStyle.revision)) {
      dirty.fill = true;
      dirty.geometry = true;
      dirty.dynamic = true;
      dirty.outerLabel = true;
    }
    if (previewChanged) {
      for (const preview of [paintedSettingsColorRef.current, settingsColorPreview]) {
        const affected = dirtyLayersForSettingsColor(preview, chart, effectiveTheme);
        dirty.fill ||= affected.fill;
        dirty.geometry ||= affected.geometry;
        dirty.dynamic ||= affected.dynamic;
        dirty.outerLabel ||= affected.outerLabel;
      }
    }
    // Snapshot invalidation describes daemon-frame changes only. A local
    // aspect selection is its own Canvas input, so it must not inherit an
    // overlay-only settle's zero-dirty plan and wait for an unrelated redraw.
    // Repaint just the dynamic layer; geometry and outer labels stay retained.
    if (paintedAspectInteractionKeyRef.current !== aspectInteractionPaintKey) {
      dirty.dynamic = true;
    }

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
          schedule({ fill: false, geometry: false, dynamic: false, outerLabel: true });
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
    const roleFonts = [
      chartBodySymbolFont,
      chartSignSymbolFont,
      chartTermSymbolFont,
      chartDecanSymbolFont,
      chartAspectSymbolFont,
    ];
    const fontsAlreadyReady = chartFontsAreReady(
      chartTextFont,
      chartSymbolFont,
      roleFonts,
    );
    if (fontsAlreadyReady) {
      recordChartPerf("chart-font-wait", {
        docId: chart.document?.documentId ?? null,
        alreadyReady: true,
        waitMs: 0,
      });
      drawInitial(true);
    } else {
      awaitFonts(chartTextFont, chartSymbolFont, roleFonts)
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
      const resized = resolveTarget(rect);
      scaleRetainedCanvases(resized.target);
      // Modules keep their own size; they repaint at once for the new surface
      // (Moon text inside its box until the settled paint knows the wheel).
      applyCanvasPaintRect(dashboardCanvas, rect.width, rect.height);
      paintDashboardLayer(rect, resized.dashboardLayout);
      if (resizeSettleTimerRef.current != null) {
        window.clearTimeout(resizeSettleTimerRef.current);
      }
      resizeSettleTimerRef.current = window.setTimeout(() => {
        schedule({ fill: true, geometry: true, dynamic: true, outerLabel: true });
      }, 90);
    });
    ro.observe(wrap);
    // Dev copy editor: repaint every layer so painted labels become selectable.
    const stopCopyEditorRepaint = onCopyEditorRepaint(() =>
      schedule({ fill: true, geometry: true, dynamic: true, outerLabel: true }),
    );

    return () => {
      cancelled = true;
      ro.disconnect();
      stopCopyEditorRepaint();
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
  }, [chart, renderSnapshot, chartTextFont, chartSymbolFont, chartBodySymbolFont, chartSignSymbolFont, chartTermSymbolFont, chartDecanSymbolFont, chartAspectSymbolFont, renderStyle, wheelVerticalAlignment, frameTune, selectedAspectBody, hideAllAspects, minorOnlyAspects, aspectInteractionPaintKey, styleEditorActive, styleAuthoringEditScope, effectiveWheelAuthoringOverrides, styleWorkingPreviewActive, settingsColorPreview, effectiveTheme, setHoveredRegion, setTrackedFlagAnchor, mapRenderedPointToViewport, updateHoverFromClientPoint, t]);

  const stylePointFromClient = useCallback((clientX: number, clientY: number): StyleScenePoint | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    return mapPointerToRenderedPoint(clientX - rect.left, clientY - rect.top);
  }, [mapPointerToRenderedPoint]);

  /**
   * Apply a ring-radius drag.
   *
   * The gesture authors exactly one radius: the ring under the pointer. Rings
   * that have to move out of its way are not written, because an unpinned
   * boundary already yields to a pin when the wheel is solved — so the carry is
   * reproduced on every render from a single authored value. Writing every
   * displaced ring instead, as this did, pinned the whole stack after one drag.
   * That left an over-constrained wheel with nothing free to absorb the next
   * edit, and it is what made a collapse unrecoverable.
   *
   * The clamp is done in the reference space the value is stored in. The drag
   * produces a reference-space radius, while the solver reports its legal
   * interval in rendered pixels; clamping against the rendered interval and
   * storing that was a units mismatch, and the stored value was then scaled a
   * second time on the next paint.
   *
   * A chart-scale patch takes the other path deliberately: it is a ratio, not a
   * radius in any space, and its wall travels on the handle, so it is written
   * exactly as the gesture resolved it. That is also what keeps a scale from
   * authoring a ring — scaling the wheel must leave every band as authored.
   */
  const applyStyleHandlePatch = (patch: StyleSceneTokenPatch) => {
    const startValue = styleHandleDragRef.current?.handle.binding?.value;
    if (startValue != null && Math.abs(patch.value - startValue) < 1e-9) {
      useChartStyleEditorStore.getState().restoreGestureProperty(patch.semanticId, CANVAS_GESTURE_OWNER);
      return;
    }
    // Written exactly as the gesture resolved it.
    //
    // There used to be a second clamp here, against a range solved separately
    // from the one the handle's own wall came from. Two models of one stack is
    // what produced the snap on the first pixel of a drag, and the clamp's
    // existence was the evidence that the first wall was not trusted. The wall
    // now travels on the handle, resolved from the same solve that placed it,
    // so re-clamping here could only disagree with it.
    setStyleOverride(patch.semanticId, patch.value, patch.radiusTarget);
  };

  const previewStyleHandlePatch = (
    patch: StyleSceneTokenPatch,
    handle: StyleSceneHandle,
    point: StyleScenePoint,
  ) => {
    styleHandlePatchRef.current = patch;
    if (handle.kind === "radial") {
      // The scene is not rebuilt mid-drag, so the dragged handle follows the
      // pointer along its own axis.
      const [cx, cy] = handle.center;
      const radius = Math.hypot(point[0] - cx, point[1] - cy);
      const reach = Math.hypot(handle.position[0] - cx, handle.position[1] - cy);
      const ratio = reach > 1e-6 ? radius / reach : 1;
      setDraggedHandleView({
        id: handle.id,
        radius,
        position: [cx + (handle.position[0] - cx) * ratio, cy + (handle.position[1] - cy) * ratio],
      });
    } else {
      setDraggedHandleView({ id: handle.id, radius: 0, position: point });
    }
    const state = useChartStyleEditorStore.getState();
    const startValue = handle.binding?.value;
    const next = startValue != null && Math.abs(patch.value - startValue) < 1e-9
      ? state
      : applyOverrideEdit(state, patch.semanticId, patch.value, patch.radiusTarget);
    if (next === state) {
      setStyleDragPreview(null);
      return;
    }
    setStyleDragPreview({
      revision: styleDragPreviewRevision(state.revision),
      semanticOverrides: next.semanticOverrides ?? state.semanticOverrides,
      resolvedOverrides: next.resolvedOverrides ?? state.resolvedOverrides,
      cssOverrides: next.cssOverrides ?? state.cssOverrides,
      geometryOverrides: next.geometryOverrides ?? state.geometryOverrides,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // A finger has no hover: a tap resolves its own flag (handleClick), so a
    // touch drag across the wheel does no per-move hit testing or re-render.
    if (event.pointerType === "touch" && !styleEditorActive) return;
    lastPointerClientRef.current = { x: event.clientX, y: event.clientY };
    if (styleEditorActive) {
      const point = stylePointFromClient(event.clientX, event.clientY);
      const drag = styleHandleDragRef.current;
      if (point && drag) {
        const patch = resolveWheelStyleHandleDrag(
          drag.handle,
          { start: drag.start, current: point },
          (semanticId) => useChartStyleEditorStore.getState().tokenBounds[semanticId],
        );
        if (patch && drag.handle.elementId === WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale) {
          previewChartScale(patch, drag.handle);
        } else if (patch) {
          previewStyleHandlePatch(patch, drag.handle, point);
        }
        return;
      }
      const hit = point && styleSceneRef.current
        ? hitTestWheelStyleScene(styleSceneRef.current, point[0], point[1])
        : null;
      const current = useChartStyleEditorStore.getState().hoveredElement;
      if ((current?.id ?? null) !== (hit?.element.id ?? null)) {
        setHoveredStyleElement(hit?.element ?? null);
      }
      hoveredKeyRef.current = null;
      setHoveredRegion(null);
      setTrackedFlagAnchor(null);
      return;
    }
    updateHoverFromClientPoint(event.clientX, event.clientY);
  };

  // A tapped flag stays up until the next tap (touch has no pointer-leave
  // hover end); a touch anywhere outside the wheel, such as the phone
  // navigation or a sheet, dismisses it.
  useEffect(() => {
    const dismissTouchFlag = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (wrapRef.current?.contains(event.target as Node)) return;
      hoveredKeyRef.current = null;
      setTrackedFlagAnchor(null);
    };
    document.addEventListener("pointerdown", dismissTouchFlag, true);
    return () => document.removeEventListener("pointerdown", dismissTouchFlag, true);
  }, [setTrackedFlagAnchor]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPointerTypeRef.current = event.pointerType;
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    // A finger "leaves" on every lift; keep the tapped flag until the next tap.
    if (event.pointerType === "touch") return;
    lastPointerClientRef.current = null;
    hoveredKeyRef.current = null;
    setHoveredRegion(null);
    setTrackedFlagAnchor(null);
    setHoveredStyleElement(null);
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

  const handleStyleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!styleEditorActive) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const [x, y] = mapPointerToRenderedPoint(event.clientX - rect.left, event.clientY - rect.top);
    const sceneHit = styleSceneRef.current
      ? hitTestWheelStyleScene(styleSceneRef.current, x, y)
      : null;
    // One level down, to exactly what is under the cursor. The click that
    // opened this double-click already selected the family, so this is the
    // descent rather than a second, competing selection.
    if (sceneHit) selectStyleElement(sceneHit.element);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const [x, y] = mapPointerToRenderedPoint(event.clientX - rect.left, event.clientY - rect.top);
    if (styleEditorActive) {
      const sceneHit = styleSceneRef.current
        ? hitTestWheelStyleScene(styleSceneRef.current, x, y)
        : null;
      if (!sceneHit) {
        clearStyleSelection();
        return;
      }
      // Selection starts at the top of the hierarchy, as it does in every
      // comparable tool: a click gets the whole reading, a double-click gets
      // the one part under the cursor. A class in no family selects itself,
      // so the depth a click reaches is simply how deep that class goes.
      const hitClassId = sceneHit.element.appearanceClassId ?? styleSceneClassId(sceneHit.element);
      const owner = WHEEL_CLASS_FAMILY_OWNER_BY_MEMBER.get(hitClassId);
      const ownerElement = owner
        ? styleSceneRef.current?.elements.find(
            (element) => styleSceneClassId(element) === owner,
          ) ?? null
        : null;
      if (ownerElement) {
        selectStyleElement(ownerElement);
        return;
      }
      const family = WHEEL_CLASS_FAMILY_BY_MEMBER.get(hitClassId);
      if (family) selectStyleFamily(sceneHit.element, family);
      else selectStyleElement(sceneHit.element);
      return;
    }
    // Touch has no hover: a tap shows the same flag a mouse hover would. It
    // runs after this click's own handling (an aspect-target click clears the
    // flag, which a mouse restores on its next move but a finger cannot).
    const touch = lastPointerTypeRef.current === "touch";
    if (touch) {
      const { clientX, clientY } = event;
      window.requestAnimationFrame(() => updateHoverFromClientPoint(clientX, clientY, true));
    }
    const resolvedHit = touch
      ? findTouchHitRegion(hitRegionsRef.current, x, y, touchHitSlop())
      : findHitRegion(hitRegionsRef.current, x, y);
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
          clearAspectSelection(chart.document?.documentId);
          ensureGlobalAspectsVisible("midband-click");
          return;
        }
        // Empty inner band → hide ALL aspects (toggle). hide_all branch.
        clearFloatingFlagAfterAspectClick();
        toggleHideAllAspects(chart.document?.documentId);
        return;
      }
      // A target whose aspects we can force-show: planet, angle, Fortune, Vertex,
      // or a primary secondary-ring point. Same target again clears; different
      // target switches (morin.py:4250-4284).
      const bodyKey = clickAspectBodyKey(hit);
      if (bodyKey) {
        clearFloatingFlagAfterAspectClick();
        toggleSelectedAspectBody(bodyKey, chart.document?.documentId);
        ensureGlobalAspectsVisible("aspect-target-click");
        if (pinOnClick) {
          const region = hitToHover(hit);
          if (region) setInspectorActiveRegion(region);
        }
        return;
      }
      clearFloatingFlagAfterAspectClick();
      clearAspectSelection(chart.document?.documentId);
    }

    if (hit && hit.kind !== "midband_empty") {
      if (pinOnClick) {
        // A dashboard declination zone pins its body, as the wheel glyph does.
        const pinned = hit.kind === "declination"
          ? wheelRegionsRef.current.find((region) => region.kind === "planet" && region.seId === hit.seId && region.chartRole !== "outer")
          : hit;
        setInspectorActiveRegion(pinned ? hitToHover(pinned) : null);
      }
    } else if (pinOnClick) {
      // Click in empty area clears the pin.
      setInspectorActiveRegion(null);
    }
  };

  const startStyleHandleDrag = (
    event: React.PointerEvent<SVGGraphicsElement>,
    handle: StyleSceneHandle,
  ) => {
    if (!handle.binding || handle.editability.state !== "editable") return;
    const editorState = useChartStyleEditorStore.getState();
    if (isWheelGeometryKey(handle.binding.semanticId) && (
      editorState.geometryTransition ||
      editorState.geometryProfile !== styleSceneRef.current?.profile
    )) return;
    const point = stylePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // No ring snapshot is needed: the handle captured here carries its
    // gesture-start value, and the drag resolves that value plus the total
    // pointer delta, so it is already a function of the start and the pointer.
    styleHandleDragRef.current = { handle, start: point };
    const element = styleSceneRef.current?.elements.find((candidate) => candidate.id === handle.elementId);
    if (element) selectStyleElement(element);
    // A field may still hold an open transaction from its focus. Close it on
    // its own terms first, so this drag is its own undo step rather than
    // silently extending — and then committing — someone else's.
    if (editorState.gestureStart && editorState.gestureOwner !== CANVAS_GESTURE_OWNER) {
      editorState.endGesture(editorState.gestureOwner as string);
    }
    beginStyleGesture(CANVAS_GESTURE_OWNER);
  };

  const endStyleHandleDrag = () => {
    if (!styleHandleDragRef.current) return;
    const scalePreview = chartScalePreviewRef.current;
    if (scalePreview) {
      const startValue = styleHandleDragRef.current.handle.binding?.value;
      if (startValue != null && Math.abs(scalePreview.patch.value - startValue) >= 1e-9) {
        // Until the release paint lands, the layers on screen are the old
        // paint shown through the preview transform. Record that, so the
        // paint resets every layer and pointer mapping stays honest.
        retainedPaintTransformRef.current = scalePreview.transform;
        chartScalePreviewRef.current = null;
        applyStyleHandlePatch(scalePreview.patch);
      } else {
        clearChartScalePreview();
      }
    }
    const handlePatch = styleHandlePatchRef.current;
    styleHandlePatchRef.current = null;
    // One store write; React batches it with clearing the preview, so the next
    // paint reads the stored edit directly.
    if (handlePatch) applyStyleHandlePatch(handlePatch);
    setStyleDragPreview(null);
    setDraggedHandleView(null);
    styleHandleDragRef.current = null;
    endStyleGesture(CANVAS_GESTURE_OWNER);
  };

  const currentStyleScene = styleScene;
  const currentSelectedStyleElement = selectedStyleElement && currentStyleScene
    ? currentStyleScene.elements.find((element) => element.id === selectedStyleElement.id) ?? null
    : null;
  const currentHoveredStyleElement = hoveredStyleElement && currentStyleScene
    ? currentStyleScene.elements.find((element) => element.id === hoveredStyleElement.id) ?? null
    : null;
  // Boundary handles belong to whatever is selected; the chart-scale handle is
  // always on offer, because scale is a tool rather than a property of one ring
  // and its element is deliberately not clickable — a hit circle at the wheel's
  // rim would swallow clicks meant for the outermost ring.
  const chartScaleHandleCandidate = currentStyleScene?.handles.find(
    (handle) => handle.elementId === WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale,
  );
  const chartScaleHandle = chartScaleHandleCandidate?.kind === "radial"
    ? chartScaleHandleCandidate
    : null;
  const withDragView = <T extends StyleSceneHandle>(handle: T): T => (
    draggedHandleView?.id === handle.id
      ? { ...handle, radius: draggedHandleView.radius, position: draggedHandleView.position }
      : handle
  );
  const visibleStyleHandles = (currentSelectedStyleElement?.handles ?? []).filter(
    (handle) => handle.elementId !== WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale,
  ).map(withDragView);
  // Always on offer: resizing the whole ring is a tool, not a property of
  // whichever line happens to be selected.
  const bandSpanHandles = (currentStyleScene?.handles ?? []).flatMap((handle) =>
    handle.elementId.startsWith(`${WHEEL_STYLE_SCENE_ELEMENT_IDS.bandSpan}.`)
    && handle.kind === "radial"
      ? [withDragView(handle)]
      : [],
  );

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
  const canvas = (
    <div
        ref={wrapRef}
        data-aries-chart-document={chart.document?.documentId}
        data-aries-true-color=""
        className={cn(
          className ?? "relative flex h-full w-full flex-1 items-center justify-center",
          (paintEffectsActive ?? (hasProfilePaintEffects || hasDraftPaintEffects)) &&
            "aries-chart-paint-effects",
          styleEditorActive && "cursor-crosshair",
          "select-none",
        )}
        style={styleEditorCanvasStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerUp={endStyleHandleDrag}
        onPointerCancel={endStyleHandleDrag}
        onClick={handleClick}
        onDoubleClick={handleStyleDoubleClick}
      >
        <canvas ref={fillRef} className="absolute inset-0 block" />
        <canvas ref={geometryRef} className="absolute inset-0 block" />
        <canvas ref={dynamicRef} className="absolute inset-0 block" />
        <canvas
          ref={dashboardRef}
          data-aries-chart-layer="dashboard"
          className="pointer-events-none absolute inset-0 hidden"
        />
        <canvas
          ref={outerLabelRef}
          data-aries-chart-layer="outer-label"
          className="pointer-events-none absolute inset-0 z-[41] block"
        />
        {styleEditorActive && currentStyleScene ? (
          <svg
            ref={styleOverlayRef}
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
            aria-hidden="true"
          >
            {currentHoveredStyleElement?.hitGeometry && !styleGestureActive &&
            currentHoveredStyleElement.id !== currentSelectedStyleElement?.id ? (
              <SceneGeometryOutline
                geometry={currentHoveredStyleElement.hitGeometry}
                tone="hover"
                keyPrefix={`hover:${currentHoveredStyleElement.id}`}
              />
            ) : null}
            {currentSelectedStyleElement?.hitGeometry && !styleGestureActive ? (
              <SceneGeometryOutline
                geometry={currentSelectedStyleElement.hitGeometry}
                tone="selected"
                keyPrefix={`selected:${currentSelectedStyleElement.id}`}
              />
            ) : null}
            {visibleStyleHandles.map((handle) => (
              <g key={handle.id}>
                {handle.kind === "radial" ? (
                  <line
                    x1={handle.center[0]}
                    y1={handle.center[1]}
                    x2={handle.position[0]}
                    y2={handle.position[1]}
                    className="stroke-[rgba(160,191,255,0.55)] [stroke-dasharray:3_3] [vector-effect:non-scaling-stroke]"
                  />
                ) : null}
                <circle
                  cx={handle.position[0]}
                  cy={handle.position[1]}
                  r={5}
                  className={cn(
                    "[vector-effect:non-scaling-stroke]",
                    handle.editability.state === "editable"
                      ? "pointer-events-auto cursor-grab fill-[#dce7ff] stroke-[#4d76cf] stroke-[1.5] active:cursor-grabbing"
                      : "fill-[#7b7f89] stroke-[#343740] stroke-[1.5]",
                  )}
                  onPointerDown={(event) => startStyleHandleDrag(event, handle)}
                  onClick={(event) => event.stopPropagation()}
                />
              </g>
            ))}
            {/* Chart scale. Drawn as a diamond rather than a disc so the one
                handle that resizes the whole wheel can never be mistaken for
                the discs that move a single boundary. */}
            {chartScaleHandle ? (
              <g>
                <circle
                  cx={chartScaleHandle.center[0]}
                  cy={chartScaleHandle.center[1]}
                  r={chartScaleHandle.radius}
                  fill="none"
                  className="opacity-45 [stroke:var(--aries-style-lab-selection)] [stroke-dasharray:2_6] [vector-effect:non-scaling-stroke]"
                />
                <rect
                  x={chartScaleHandle.position[0] - 5}
                  y={chartScaleHandle.position[1] - 5}
                  width={10}
                  height={10}
                  transform={`rotate(45 ${chartScaleHandle.position[0]} ${chartScaleHandle.position[1]})`}
                  className="pointer-events-auto cursor-grab [fill:var(--aries-inspector-background)] [stroke:var(--aries-style-lab-selection)] stroke-[1.5] [vector-effect:non-scaling-stroke] active:cursor-grabbing"
                  onPointerDown={(event) => startStyleHandleDrag(event, chartScaleHandle)}
                  onClick={(event) => event.stopPropagation()}
                />
              </g>
            ) : null}
            {/* The chart ring. The dashed circle marks the boundary this
                diamond drags, so it is clear which line it owns. */}
            {bandSpanHandles.map((handle) => (
              <g key={handle.id}>
                <circle
                  cx={handle.center[0]}
                  cy={handle.center[1]}
                  r={handle.radius}
                  fill="none"
                  className="opacity-55 [stroke:var(--aries-style-lab-selection)] [stroke-dasharray:4_4] [vector-effect:non-scaling-stroke]"
                />
                <rect
                  x={handle.position[0] - 5}
                  y={handle.position[1] - 5}
                  width={10}
                  height={10}
                  transform={`rotate(45 ${handle.position[0]} ${handle.position[1]})`}
                  className="pointer-events-auto cursor-grab [fill:var(--aries-inspector-background)] [stroke:var(--aries-style-lab-selection)] stroke-[1.5] [vector-effect:non-scaling-stroke] active:cursor-grabbing"
                  onPointerDown={(event) => startStyleHandleDrag(event, handle)}
                  onClick={(event) => event.stopPropagation()}
                />
              </g>
            ))}
          </svg>
        ) : null}
        {/* Hover-flag — the compact glyph card pinned to the hovered
            symbol (chartinspector.build_flag_payload, the second inspector entry
            point). Portaled to document.body so pane overflow cannot clip it;
            renders daemon JSON verbatim. */}
        {styleEditorActive ? null : <ChartHoverFlag anchor={flagAnchor} chart={chart} />}
        {DESIGN_TUNERS_ENABLED && designTunerOpen && appControlsEnabled ? <WheelFrameTuner /> : null}
        {/* Corner labels (date/time, place/coords, house-system, overlay)
            are rendered by `workspace-content.tsx` as siblings to ChartCanvas —
            see CornerLines + OverlayCorner. Already chart-size-aware. */}
    </div>
  );
  return appControlsEnabled ? (
    <ChartContextMenu chart={chart} dashboardAtPoint={(clientX, clientY) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      return Boolean(rect && dashboardContainsPoint(dashboardLayoutRef.current, clientX - rect.left, clientY - rect.top));
    }} regionAtPoint={(clientX, clientY) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const [x, y] = mapPointerToRenderedPoint(clientX - rect.left, clientY - rect.top);
      const hit = findHitRegion(hitRegionsRef.current, x, y);
      return hit ? hitToHover(hit) : null;
    }}>{canvas}</ChartContextMenu>
  ) : canvas;
}
