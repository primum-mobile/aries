// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

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
  resolveWheelRenderStyleFromTokens,
  resolveWheelScale,
  wheelFillUsesSolarDirection,
  type WheelGeometryInput,
  type WheelRenderStyle,
} from "@/lib/chart/wheel-render-style";
import {
  WHEEL_AUTHORING_OVERRIDE_PREFIX,
  variantAuthoredOverrideIds,
  wheelAuthoringOverrideId,
  wheelRingRoleForClass,
} from "@/lib/style-lab/wheel-authoring-adapter";
import {
  awaitFonts,
  chartFontsAreReady,
  computeHitRegions,
  drawSnapshotLayer,
  findHitRegion,
  resolveChartOuterPaintEnvelope,
  type ChartHitRegion,
  type OuterLabelCollisionBounds,
} from "@/lib/chart/draw-chart";
import { resolveChartPaintTarget } from "@/lib/chart/outer-glyph-lane";
import { fetchDocumentSnapshot, patchOptions } from "@/lib/daemon/client";
import type { ThemeState } from "@/lib/daemon/client";
import {
  applyProfileColorsToSnapshot,
  neutralChartPalette,
  readPaletteFromTheme,
  readPaletteProfileOverrides,
} from "@/lib/chart/palette";
import {
  chartPerfEnabled,
  perfNow,
  recordChartPerf,
  speedlogEnabled,
} from "@/lib/chart/perf";
import { acknowledgePaintedDocumentSnapshot } from "@/lib/chart/painted-snapshot-registry";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { STYLE_FONT_ASSETS_READY_EVENT } from "@/lib/style-lab/fonts";
import { compileFlatWheelAuthoringOverrides } from "@/lib/style-lab/wheel-authoring-adapter";
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
import type { Chart, ChartRenderSnapshot } from "@/lib/chart/types";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useThemeStore } from "@/stores/theme-store";
import { hoverRegionKey, useWorkspaceStore, type HoverRegion } from "@/stores/workspace-store";

type DirtyState = {
  fill: boolean;
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
): ChartTargetRect {
  const target = resolveChartPaintTarget(
    width,
    height,
    paintRadiusScale,
    topBoundary,
    avoidTitlebar,
  );
  return {
    x: (width - target.side) / 2,
    y: target.centerY - target.side / 2,
    side: target.side,
  };
}

function chartTitlebarCollisionBounds(
  hostRect: DOMRect,
): OuterLabelCollisionBounds | null {
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
  if (plan) {
    return {
      fill: false,
      geometry: Boolean(plan.geometry),
      dynamic: Boolean(plan.dynamic),
      outerLabel: Boolean(plan.outerLabel),
    };
  }
  if (chart.overlayRenderMode === "step_fast") {
    return { fill: false, geometry: true, dynamic: true, outerLabel: true };
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

function semanticChartFrameSignature(chart: Chart | null | undefined): string {
  if (!chart) return "none";
  const degrees = (value: number) => Number(value).toFixed(8);
  return [
    chart.meta.datetime,
    `asc:${degrees(chart.angles.asc)}`,
    `mc:${degrees(chart.angles.mc)}`,
    ...chart.planets.map((planet) => `${planet.id}:${degrees(planet.longitude)}`),
  ].join("|");
}

function semanticFrameSignature(snapshot: ChartRenderSnapshot): string {
  return [
    snapshot.displayDatetime,
    `primary:${semanticChartFrameSignature(snapshot.primaryChart)}`,
    `comparison:${semanticChartFrameSignature(snapshot.comparisonChart)}`,
  ].join("||");
}

function overlayPerfState(snapshot: ChartRenderSnapshot) {
  const displayChart =
    snapshot.document?.compoundKind === "synastry" && snapshot.comparisonChart
      ? snapshot.primaryChart
      : snapshot.comparisonChart ?? snapshot.primaryChart;
  const rows = displayChart.overlay?.rows ?? [];
  const groupCounts = { dayhour: 0, header: 0, signal: 0 };
  const signatures = rows.map((row) => {
    const group = row.group ?? "row";
    if (group === "dayhour" || group === "header" || group === "signal") {
      groupCounts[group] += 1;
    }
    const glyphs = row.glyphs
      .map((glyph) => `${glyph.kind ?? ""}:${glyph.seId ?? ""}:${glyph.char}`)
      .join("|");
    return {
      group,
      slot: row.slot ?? null,
      signature: `${row.slot ?? row.label}:${glyphs}:${row.trailing ?? ""}`,
    };
  });
  return {
    deferredSignals: displayChart.overlay?.deferredSignals === true,
    groupCounts,
    rows: signatures,
  };
}

function shouldDeferOuterLabel(chart: ChartRenderSnapshot) {
  return Boolean(
    chart.renderInvalidation?.deferredOuterLabel ?? chart.overlayRenderMode === "deferred",
  );
}

function hitToHover(hit: ChartHitRegion): HoverRegion | null {
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
  if (hit.kind === "drishti") {
    return {
      kind: "drishti",
      relationId: hit.relationId,
      method: hit.method,
    };
  }
  if (hit.kind === "pd_event") {
    return {
      kind: "pd_event",
      eventId: hit.eventId,
      eventKind: hit.eventKind,
      component: hit.component,
      partyRole: hit.partyRole,
      sourceRole: hit.sourceRole,
      track: hit.track,
      motion: hit.motion,
      exactNow: hit.exactNow,
      longitude: hit.longitude,
      nativeCoordinate: hit.nativeCoordinate,
      directionState: hit.directionState,
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
  if (hit.kind === "eclipse") {
    return `${hit.chartRole === "outer" ? "outer:" : ""}eclipse`;
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

/**
 * Which reading each class belongs to. Fixed by the manifest, so it is derived
 * once rather than per render or per click.
 */
/**
 * Who owns a gesture opened by dragging a handle on the wheel.
 *
 * Distinct from the inspector's owner so a drag started while a numeric field
 * still has focus opens — or is refused — on its own terms, instead of silently
 * joining that field's transaction and committing it on release.
 */
/**
 * Split an authoring override id back into the scope and class it addresses.
 * Only radius ids matter here; anything else falls through untouched.
 *
 * Module scope: it depends on nothing in the component, and as a component-local
 * `const` it sat in the temporal dead zone for anything above its own line.
 */
function parseRingRadiusSemanticId(semanticId: string) {
  if (!semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX)) return null;
  if (!semanticId.endsWith(".radius")) return null;
  const body = semanticId.slice(
    WHEEL_AUTHORING_OVERRIDE_PREFIX.length,
    semanticId.length - ".radius".length,
  );
  const cut = body.indexOf(".");
  if (cut <= 0) return null;
  return {
    scope: body.slice(0, cut) as Parameters<typeof wheelAuthoringOverrideId>[0],
    classId: body.slice(cut + 1),
  };
}

const CANVAS_GESTURE_OWNER = "canvas" as const;

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
}: {
  chart: ChartRenderSnapshot;
  className?: string;
  paintEffectsActive?: boolean;
  appControlsEnabled?: boolean;
  inheritAppTheme?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<HTMLCanvasElement>(null);
  const dynamicRef = useRef<HTMLCanvasElement>(null);
  const outerLabelRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const deferTimerRef = useRef<number | null>(null);
  const resizeSettleTimerRef = useRef<number | null>(null);
  const renderedSizeRef = useRef<RenderedCanvasState | null>(null);
  const retainedPaintTransformRef = useRef<RetainedPaintTransform | null>(null);
  const renderedDocumentRef = useRef<string | null>(null);
  const paintedFillSignatureRef = useRef<string | null>(null);
  const paintedSolarFillSignatureRef = useRef<string | null>(null);
  const paintedRenderStyleRevisionRef = useRef<string | null>(null);
  const paintedAspectInteractionKeyRef = useRef<string | null>(null);
  const paintedStyleTargetModeRef = useRef<boolean | null>(null);
  const hitRegionsRef = useRef<ChartHitRegion[]>([]);
  const styleSceneRef = useRef<WheelStyleScene | null>(null);
  const styleHandleDragRef = useRef<{
    handle: StyleSceneHandle;
    start: StyleScenePoint;
  } | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null);
  // The hovered symbol + its canvas-local pixel centre, driving the on-chart
  // hover-flag overlay (chartinspector.build_flag_payload). The hit region's
  // (x, y) IS the region centre — the anchor wx computes in
  // _hover_flag_anchor_for_region (workspace_shell.py:5262).
  const [flagAnchor, setFlagAnchor] = useState<FlagAnchor | null>(null);
  const [fontAssetRevision, setFontAssetRevision] = useState(0);
  const [styleScene, setStyleScene] = useState<WheelStyleScene | null>(null);
  const flagAnchorRef = useRef<FlagAnchor | null>(null);
  const flagAnchorTokenRef = useRef(0);
  const setHoveredRegion = useWorkspaceStore((s) => s.setHoveredRegion);
  const setInspectorActiveRegion = useWorkspaceStore((s) => s.setInspectorActiveRegion);
  const inspectorOpen = useFrameLayoutStore((s) => s.inspectorOpen);
  const selectedAspectBody = useWorkspaceStore((s) => s.selectedAspectBody);
  const hideAllAspects = useWorkspaceStore((s) => s.hideAllAspects);
  const minorOnlyAspects = useWorkspaceStore((s) => s.minorOnlyAspects);
  const toggleSelectedAspectBody = useWorkspaceStore((s) => s.toggleSelectedAspectBody);
  const toggleHideAllAspects = useWorkspaceStore((s) => s.toggleHideAllAspects);
  const clearAspectSelection = useWorkspaceStore((s) => s.clearAspectSelection);
  const pushCommandSnapshot = useDaemonWorkspaceStore((s) => s.pushCommandSnapshot);
  const appTheme = useThemeStore((s) => s.theme);
  const theme = inheritAppTheme ? appTheme : null;
  const styleEditorActive = useChartStyleEditorStore((s) => s.active);
  const styleWorkingPreviewActive = useChartStyleEditorStore(
    (s) => s.liveAppThemePreview,
  );
  const styleEditorRevision = useChartStyleEditorStore((s) => s.revision);
  const styleCssOverrides = useChartStyleEditorStore((s) => s.cssOverrides);
  const styleLabBaseTheme = useChartStyleEditorStore((s) => s.styleLabBaseTheme);
  // The resolved map, not the authored one: a class that follows a palette
  // role must reach the wheel as the colour it resolves to, never as the
  // reference itself.
  const styleSemanticOverrides = useChartStyleEditorStore((s) => s.resolvedOverrides);
  const styleAuthoringEditScope = useChartStyleEditorStore((s) => s.authoringEditScope);
  const selectedStyleElement = useChartStyleEditorStore((s) => s.selectedElement);
  // Non-null only while a value is actively being changed. Max: "for color
  // changes the pink must disappear" — during the moment of judgement the
  // chrome must not sit on the thing being judged.
  const styleGestureActive = useChartStyleEditorStore((s) => s.gestureStart != null);
  // The geometry and style the current scene was built from, so a live ring
  // drag resolves its push against exactly what is on screen.
  const styleGeometryRef = useRef<{
    input: WheelGeometryInput;
    style: WheelRenderStyle;
  } | null>(null);

  const hoveredStyleElement = useChartStyleEditorStore((s) => s.hoveredElement);
  const setHoveredStyleElement = useChartStyleEditorStore((s) => s.setHoveredElement);
  const selectStyleElement = useChartStyleEditorStore((s) => s.selectElement);
  const selectStyleFamily = useChartStyleEditorStore((s) => s.selectFamily);
  const clearStyleSelection = useChartStyleEditorStore((s) => s.clearSelection);
  // Which boundary is under active edit, drag or keyboard. Only while a gesture
  // is open: a stored profile has no active boundary, and merely *selecting* a
  // ring must not change how the wheel resolves.
  const styleActivePropertyId = useChartStyleEditorStore((s) => s.activePropertyId);
  // State, not the drag ref: it must be readable during render, and setting it
  // at pointer-down means the push is in force from the first pixel rather than
  // arriving a frame late.
  const [activeDragSemanticId, setActiveDragSemanticId] = useState<string | null>(null);
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
        chartData: {},
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

  const effectiveTheme = useMemo(() => {
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

  const palette = useMemo(
    () => ({
      ...(inheritAppTheme ? readPaletteFromTheme(effectiveTheme) : neutralChartPalette()),
      ...(chart.primaryChart.palette ?? {}),
      ...readPaletteProfileOverrides(effectiveTheme),
    }),
    [chart, effectiveTheme, inheritAppTheme],
  );
  const renderSnapshot = useMemo(
    () => applyProfileColorsToSnapshot(chart, effectiveTheme),
    [chart, effectiveTheme],
  );
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
  const effectiveWheelAuthoringOverrides = useMemo(
    () => ({
      ...(effectiveTheme?.profileOverrides?.wheelAuthoring ?? {}),
      ...(styleWorkingPreviewActive ? styleSemanticOverrides : {}),
    }),
    [
      effectiveTheme?.profileOverrides?.wheelAuthoring,
      styleWorkingPreviewActive,
      styleSemanticOverrides,
    ],
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
        setActiveDragSemanticId(null);
        cancelStyleGesture(CANVAS_GESTURE_OWNER);
        event.preventDefault();
        return;
      }
      // With no edit in flight, Escape is the way back up the hierarchy — the
      // counterpart to the double-click that went down.
      if (state.selectedFamily || !state.selectedElement) return;
      const selectedClassId = styleSceneClassId(state.selectedElement);
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
  }, [cancelStyleGesture, styleEditorActive]);

  const activePushRole = useMemo(() => {
    if (!styleGestureActive) return undefined;
    const semanticId = activeDragSemanticId ?? styleActivePropertyId;
    if (!semanticId) return undefined;
    const parsed = parseRingRadiusSemanticId(semanticId);
    if (!parsed) return undefined;
    return wheelRingRoleForClass(parsed.classId) ?? undefined;
  }, [activeDragSemanticId, styleGestureActive, styleActivePropertyId]);

  const renderStyle = useMemo(
    () =>
      resolveWheelRenderStyleFromTokens(
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
          authoringOverrides: compileFlatWheelAuthoringOverrides(
            effectiveWheelAuthoringOverrides,
          ),
        },
      ),
    [
      palette,
      styleRevision,
      styleEditorRevision,
      styleWorkingPreviewActive,
      styleCssOverrides,
      effectiveWheelAuthoringOverrides,
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
    void patchOptions({ display: { aspects: true } })
      .then(() => fetchDocumentSnapshot(docId))
      .then((snapshot) => pushCommandSnapshot(docId, snapshot))
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
    const fillCanvas = fillRef.current;
    const geometryCanvas = geometryRef.current;
    const dynamicCanvas = dynamicRef.current;
    const outerLabelCanvas = outerLabelRef.current;
    if (!wrap || !fillCanvas || !geometryCanvas || !dynamicCanvas || !outerLabelCanvas) {
      return;
    }

    const layoutDocumentId = chart.document?.documentId ?? null;
    if (renderedDocumentRef.current !== layoutDocumentId) {
      renderedSizeRef.current = null;
      hitRegionsRef.current = [];
      paintedFillSignatureRef.current = null;
      paintedSolarFillSignatureRef.current = null;
      paintedRenderStyleRevisionRef.current = null;
      renderedDocumentRef.current = layoutDocumentId;
    }

    let cancelled = false;
    const fillDraw = new CanvasDraw(fillCanvas);
    const geometryDraw = new CanvasDraw(geometryCanvas);
    const dynamicDraw = new CanvasDraw(dynamicCanvas);
    const outerLabelDraw = new CanvasDraw(outerLabelCanvas);
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
    const fillProfile = primary.options.theme === 2
      ? "anglo"
      : primary.options.theme === 1
        ? "compact"
        : "classic";
    const fillSignature = [
      renderStyle.revision,
      renderStyle.palette.background,
      renderStyle.palette.frame,
      fillProfile,
      Boolean(renderSnapshot.comparisonChart),
      Boolean(primary.options.showTerms),
      Boolean(primary.options.showDecans),
      Boolean(primary.options.showHouses),
      primary.options.showOuterHouseLines !== false,
      renderSnapshot.document?.compoundKind ?? "",
    ].join("|");
    // Sun-oriented materials remain retained through step_fast. The next full
    // settled snapshot repaints the fill once with the current solar bearing.
    const solarFillSignature =
      chart.overlayRenderMode !== "step_fast"
      && wheelFillUsesSolarDirection(renderStyle, fillProfile)
        ? String(primary.planets.find((planet) => planet.id === "sun")?.longitude ?? "")
        : null;

    const render = (dirty: DirtyState): boolean => {
      if (cancelled) {
        return false;
      }
      const paintStartedAt = perfNow();
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
      const effectiveDirty: DirtyState =
        !previous || !sameHostSize(previous, rect.width, rect.height)
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
      const titlebarBounds = chartTitlebarCollisionBounds(rect);
      const titlebarTopBoundary = chartTitlebarTopBoundary(rect);
      const outerLabelCollisionBounds: OuterLabelCollisionBounds[] = titlebarBounds
        ? [titlebarBounds]
        : [];
      const target = chartTargetRect(
        rect.width,
        rect.height,
        outerPaintEnvelope.paintRadiusScale,
        titlebarTopBoundary,
        outerPaintEnvelope.avoidTitlebar,
      );
      const wheelCenter: readonly [number, number] = [
        rect.width / 2,
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
      const refreshHitRegions =
        effectiveDirty.geometry
        || effectiveDirty.dynamic
        || effectiveDirty.outerLabel
        || paintedStyleTargetModeRef.current !== styleEditorActive;
      if (refreshHitRegions) {
        hitRegionsRef.current = computeHitRegions(renderSnapshot, {
          width: rect.width,
          height: rect.height,
          chartSize: target.side,
          center: wheelCenter,
          renderStyle,
          textsize: (text, textOpts) => outerLabelDraw.textsize(text, textOpts),
          clickAspectState: {
            selectedBody: selectedAspectBody,
            hideAll: hideAllAspects,
            minorOnly: minorOnlyAspects,
          },
          includeStyleTargets: styleEditorActive,
          outerLabelCollisionBounds,
        });
        paintedAspectInteractionKeyRef.current = aspectInteractionPaintKey;
        paintedStyleTargetModeRef.current = styleEditorActive;
        if (styleEditorActive) {
          const primary = renderSnapshot.primaryChart;
          const profile = primary.options.theme === 2
            ? "anglo"
            : primary.options.theme === 1
              ? "compact"
              : "classic";
          const comparison = Boolean(renderSnapshot.comparisonChart);
          const comparisonWithOuterHouseBand = Boolean(
            comparison &&
            primary.options.showHouses &&
            primary.options.showOuterHouseLines !== false &&
            profile !== "anglo",
          );
          const styleGeometryInput = {
              profile,
              mode: comparison ? "comparison" : "single",
              // The scene is built in the same scaled world the chart is
              // painted in, so a handle sits on the circle it edits.
              maxRadius: target.side / 2 * resolveWheelScale(renderStyle, profile),
              hasOuterRing: comparison || renderSnapshot.outerRingMode !== "none",
              showTerms: Boolean(primary.options.showTerms),
              showDecans: Boolean(primary.options.showDecans),
              showHouses: Boolean(primary.options.showHouses),
              showPositions: Boolean(primary.options.showPositions),
              comparisonWithOuterHouses: comparisonWithOuterHouseBand,
              restrainedAngloComparison:
                comparison &&
                profile === "anglo" &&
                renderSnapshot.document?.compoundKind === "synastry",
              // The boundary being edited, so the solver moves its neighbours
              // aside for it and reports its wall as the room the whole stack
              // has. Both surfaces feed the same field, so typing a radius and
              // dragging one behave identically.
              ...(activePushRole ? { pushBoundaryRole: activePushRole } : {}),
          } as const;
          // Kept so a live ring drag can resolve the push against the same
          // geometry the scene was built from.
          styleGeometryRef.current = { input: styleGeometryInput, style: renderStyle };
          const nextStyleScene = buildWheelStyleScene({
            style: renderStyle,
            authoringScope: styleAuthoringEditScope === "base" ? "base" : profile,
            // Asked of the *same map the wheel is painted from*, not of the
            // editor's working set alone.
            //
            // A saved profile's variant values live in the theme, not in the
            // working overrides: Paper authors
            // `authoring.wheel.anglo.canvas.chart.scale` and nothing in the
            // editor. Given only the working set, the masking check saw no
            // anglo value, so a drag on an Anglo wheel wrote base while anglo
            // went on governing — the handle tracked the pointer, the wheel
            // did not move, and the accumulated base value applied in one jump
            // the moment anything changed which scope won. That is the
            // non-continuous jump; the precedence was never wrong, the
            // question was asked of the wrong map.
            //
            // Still read imperatively for the working half, which changes on
            // every keystroke of a drag and must not re-subscribe this effect.
            variantAuthoredOverrideIds: variantAuthoredOverrideIds(
              {
                ...effectiveWheelAuthoringOverrides,
                ...(styleWorkingPreviewActive
                  ? useChartStyleEditorStore.getState().semanticOverrides
                  : {}),
              },
              profile,
            ),
            geometry: styleGeometryInput,
            center: wheelCenter,
            viewport: { width: rect.width, height: rect.height },
            ascendantDegrees: primary.angles.asc,
            useIndividualBodyColors: Boolean(primary.options.useDignityColors),
            useZodiacElementColors: Boolean(primary.options.useZodiacElementColors),
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
          const refreshedHit = hitRegionsRef.current.find((candidate) => {
            if (candidate.styleOnly || candidate.kind === "midband_empty") return false;
            return hoverRegionKey(hitToHover(candidate)) === trackedKey;
          });
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
      const hitMs = perfNow() - hitStartedAt;
      const totalMs = perfNow() - paintStartedAt;
      if (refreshHitRegions) {
        acknowledgePaintedDocumentSnapshot(chart.document?.documentId, chart);
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
        geometryMs,
        fillMs,
        dynamicMs,
        dynamicProfile,
        outerLabelMs,
        hitMs,
        totalMs,
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
      scaleRetainedCanvases(
        chartTargetRect(
          rect.width,
          rect.height,
          outerPaintEnvelope.paintRadiusScale,
          chartTitlebarTopBoundary(rect),
          outerPaintEnvelope.avoidTitlebar,
        ),
      );
      if (resizeSettleTimerRef.current != null) {
        window.clearTimeout(resizeSettleTimerRef.current);
      }
      resizeSettleTimerRef.current = window.setTimeout(() => {
        schedule({ fill: true, geometry: true, dynamic: true, outerLabel: true });
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
  }, [chart, renderSnapshot, chartTextFont, chartSymbolFont, chartBodySymbolFont, chartSignSymbolFont, chartTermSymbolFont, chartDecanSymbolFont, chartAspectSymbolFont, renderStyle, selectedAspectBody, hideAllAspects, minorOnlyAspects, aspectInteractionPaintKey, styleEditorActive, styleAuthoringEditScope, effectiveWheelAuthoringOverrides, styleWorkingPreviewActive, activePushRole, setHoveredRegion, setTrackedFlagAnchor, mapRenderedPointToViewport, updateHoverFromClientPoint]);

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
    // Written exactly as the gesture resolved it.
    //
    // There used to be a second clamp here, against a range solved separately
    // from the one the handle's own wall came from. Two models of one stack is
    // what produced the snap on the first pixel of a drag, and the clamp's
    // existence was the evidence that the first wall was not trusted. The wall
    // now travels on the handle, resolved from the same solve that placed it,
    // so re-clamping here could only disagree with it.
    setStyleOverride(patch.semanticId, patch.value);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
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
        if (patch) applyStyleHandlePatch(patch);
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

  const handlePointerLeave = () => {
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
      const hitClassId = styleSceneClassId(sceneHit.element);
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
          const region = hitToHover(hit);
          if (region) setInspectorActiveRegion(region);
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

  const startStyleHandleDrag = (
    event: React.PointerEvent<SVGGraphicsElement>,
    handle: StyleSceneHandle,
  ) => {
    if (!handle.binding || handle.editability.state !== "editable") return;
    const point = stylePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // No ring snapshot is needed: the handle captured here carries its
    // gesture-start value, and the drag resolves that value plus the total
    // pointer delta, so it is already a function of the start and the pointer.
    styleHandleDragRef.current = { handle, start: point };
    setActiveDragSemanticId(handle.binding?.semanticId ?? null);
    const element = styleSceneRef.current?.elements.find((candidate) => candidate.id === handle.elementId);
    if (element) selectStyleElement(element);
    // A field may still hold an open transaction from its focus. Close it on
    // its own terms first, so this drag is its own undo step rather than
    // silently extending — and then committing — someone else's.
    const editorState = useChartStyleEditorStore.getState();
    if (editorState.gestureStart && editorState.gestureOwner !== CANVAS_GESTURE_OWNER) {
      editorState.endGesture(editorState.gestureOwner as string);
    }
    beginStyleGesture(CANVAS_GESTURE_OWNER);
  };

  const endStyleHandleDrag = () => {
    if (!styleHandleDragRef.current) return;
    styleHandleDragRef.current = null;
    setActiveDragSemanticId(null);
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
  const visibleStyleHandles = (currentSelectedStyleElement?.handles ?? []).filter(
    (handle) => handle.elementId !== WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale,
  );
  // Always on offer: resizing the whole ring is a tool, not a property of
  // whichever line happens to be selected.
  const bandSpanHandles = (currentStyleScene?.handles ?? []).flatMap((handle) =>
    handle.elementId.startsWith(`${WHEEL_STYLE_SCENE_ELEMENT_IDS.bandSpan}.`)
    && handle.kind === "radial"
      ? [handle]
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
        className={cn(
          className ?? "relative flex h-full w-full flex-1 items-center justify-center",
          (paintEffectsActive ?? (hasProfilePaintEffects || hasDraftPaintEffects)) &&
            "aries-chart-paint-effects",
          styleEditorActive && "cursor-crosshair",
          "select-none",
        )}
        style={styleEditorCanvasStyle}
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
          ref={outerLabelRef}
          data-aries-chart-layer="outer-label"
          className="pointer-events-none absolute inset-0 z-[41] block"
        />
        {styleEditorActive && currentStyleScene ? (
          <svg
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
        {/* Corner labels (date/time, place/coords, house-system, overlay)
            are rendered by `workspace-content.tsx` as siblings to ChartCanvas —
            see CornerLines + OverlayCorner. Already chart-size-aware. */}
    </div>
  );
  return appControlsEnabled ? (
    <ChartContextMenu chart={chart}>{canvas}</ChartContextMenu>
  ) : canvas;
}
