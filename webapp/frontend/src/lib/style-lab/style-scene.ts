// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type StyleScenePoint = readonly [x: number, y: number];

export type StyleSceneHitGeometry =
  | {
      readonly kind: "circle";
      readonly center: StyleScenePoint;
      readonly radius: number;
      readonly tolerance?: number;
    }
  | {
      readonly kind: "disc";
      readonly center: StyleScenePoint;
      readonly radius: number;
    }
  | {
      readonly kind: "annulus";
      readonly center: StyleScenePoint;
      readonly innerRadius: number;
      readonly outerRadius: number;
      readonly tolerance?: number;
    }
  | {
      readonly kind: "line";
      readonly start: StyleScenePoint;
      readonly end: StyleScenePoint;
      readonly tolerance: number;
    }
  | {
      readonly kind: "rectangle";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly tolerance?: number;
    }
  | {
      readonly kind: "polar-sector";
      readonly center: StyleScenePoint;
      readonly innerRadius: number;
      readonly outerRadius: number;
      readonly startLongitude: number;
      readonly endLongitude: number;
      readonly ascendantDegrees: number;
    }
  | {
      readonly kind: "compound";
      readonly geometries: readonly StyleSceneHitGeometry[];
    };

export type StyleSceneEditability = Readonly<{
  state: "editable" | "read-only";
  reason:
    | "public-token"
    | "derived-geometry"
    | "code-owned-geometry"
    | "inactive-state"
    | "selection-only";
  detail?: string;
}>;

export type StyleSceneTokenProperty =
  | "color"
  | "radius"
  | "offset"
  | "spacing"
  | "stroke-width"
  | "stroke-dash"
  | "opacity"
  | "font-family"
  | "font-size"
  | "font-weight"
  | "effect";

export interface StyleSceneTokenBinding {
  readonly semanticId: string;
  readonly cssVar: string;
  readonly property: StyleSceneTokenProperty;
  readonly value?: string | number;
}

/** Exact conventional values exposed by the profile-v2 inspector. */
export type StyleSceneAuthoringDefaults = Readonly<{
  fontSizePx?: number;
  strokeWidthPx?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  dashOnPx?: number;
  dashOffPx?: number;
  opacityPercent?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  radiusPx?: number;
  diameterPx?: number;
}>;

interface StyleSceneHandleBase {
  readonly id: string;
  readonly elementId: string;
  readonly position: StyleScenePoint;
  readonly editability: StyleSceneEditability;
  /**
   * Signed token units per CSS pixel of handle travel. A negative value means
   * dragging outward makes the normalized inset/sector token smaller.
   */
  readonly binding?: StyleSceneTokenBinding & {
    readonly value: number;
    readonly valuePerPixel: number;
  };
}

export type StyleSceneHandle =
  | (StyleSceneHandleBase & {
      readonly kind: "radial";
      readonly center: StyleScenePoint;
      readonly radius: number;
      readonly angleDegrees: number;
    })
  | (StyleSceneHandleBase & {
      readonly kind: "linear";
      readonly origin: StyleScenePoint;
      /** Unit vector in chart-space CSS pixels. */
      readonly axis: StyleScenePoint;
    });

export interface StyleSceneElement {
  /** Stable semantic authoring target shared by every painted occurrence. */
  readonly classId: string;
  /** Optional property-level palette targets (for example one body colour). */
  readonly paletteRoleIds: readonly string[];
  /** Instance identity used only for hit testing and retained selection. */
  readonly id: string;
  readonly parentId?: string;
  readonly labelKey: string;
  readonly layer: "geometry" | "dynamic" | "outer-label" | "overlay";
  readonly primitive: "surface" | "circle" | "line" | "text" | "group";
  readonly stateTags: readonly string[];
  readonly tokenBindings: readonly StyleSceneTokenBinding[];
  readonly authoringDefaults?: StyleSceneAuthoringDefaults;
  readonly editability: StyleSceneEditability;
  readonly hitGeometry: StyleSceneHitGeometry | null;
  readonly handles: readonly StyleSceneHandle[];
  readonly priority: number;
}

export interface StyleSceneHit {
  readonly element: StyleSceneElement;
  readonly distance: number;
}

export interface StyleSceneTokenDragMetadata {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface StyleSceneHandleDrag {
  readonly start: StyleScenePoint;
  readonly current: StyleScenePoint;
}

export interface StyleSceneTokenPatch {
  readonly semanticId: string;
  readonly cssVar: string;
  readonly value: number;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function pointToSegmentDistance(
  point: StyleScenePoint,
  start: StyleScenePoint,
  end: StyleScenePoint,
): number {
  const vx = end[0] - start[0];
  const vy = end[1] - start[1];
  const lengthSquared = vx * vx + vy * vy;
  const t =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * vx + (point[1] - start[1]) * vy) /
              lengthSquared,
          ),
        )
      : 0;
  return Math.hypot(
    point[0] - (start[0] + vx * t),
    point[1] - (start[1] + vy * t),
  );
}

/** Return a useful tie-break distance when the point is inside the geometry. */
export function hitTestStyleSceneGeometry(
  geometry: StyleSceneHitGeometry,
  point: StyleScenePoint,
): number | null {
  if (geometry.kind === "compound") {
    let best: number | null = null;
    for (const child of geometry.geometries) {
      const distance = hitTestStyleSceneGeometry(child, point);
      if (distance != null && (best == null || distance < best)) best = distance;
    }
    return best;
  }
  if (geometry.kind === "line") {
    const distance = pointToSegmentDistance(point, geometry.start, geometry.end);
    return distance <= geometry.tolerance ? distance : null;
  }
  if (geometry.kind === "rectangle") {
    const tolerance = geometry.tolerance ?? 0;
    const left = geometry.x - tolerance;
    const top = geometry.y - tolerance;
    const right = geometry.x + geometry.width + tolerance;
    const bottom = geometry.y + geometry.height + tolerance;
    if (point[0] < left || point[0] > right || point[1] < top || point[1] > bottom) {
      return null;
    }
    return Math.hypot(
      point[0] - (geometry.x + geometry.width / 2),
      point[1] - (geometry.y + geometry.height / 2),
    );
  }

  const dx = point[0] - geometry.center[0];
  const dy = point[1] - geometry.center[1];
  const radius = Math.hypot(dx, dy);
  if (geometry.kind === "circle") {
    const distance = Math.abs(radius - geometry.radius);
    return distance <= (geometry.tolerance ?? 0) ? distance : null;
  }
  if (geometry.kind === "disc") {
    return radius <= geometry.radius ? radius : null;
  }
  if (geometry.kind === "annulus") {
    const tolerance = geometry.tolerance ?? 0;
    if (
      radius < geometry.innerRadius - tolerance ||
      radius > geometry.outerRadius + tolerance
    ) {
      return null;
    }
    return Math.abs(radius - (geometry.innerRadius + geometry.outerRadius) / 2);
  }

  if (radius < geometry.innerRadius || radius > geometry.outerRadius) return null;
  const longitude = normalizeDegrees(
    (Math.atan2(-dy, dx) * 180) / Math.PI - 180 + geometry.ascendantDegrees,
  );
  const span = normalizeDegrees(longitude - geometry.startLongitude);
  const sectorWidth =
    normalizeDegrees(geometry.endLongitude - geometry.startLongitude) || 360;
  return span <= sectorWidth
    ? Math.abs(radius - (geometry.innerRadius + geometry.outerRadius) / 2)
    : null;
}

export function hitTestStyleSceneElements(
  elements: readonly StyleSceneElement[],
  x: number,
  y: number,
  options: Readonly<{ includeReadOnly?: boolean }> = {},
): StyleSceneHit | null {
  let best: StyleSceneHit | null = null;
  for (const element of elements) {
    if (!element.hitGeometry) continue;
    if (!options.includeReadOnly && element.editability.state === "read-only") continue;
    const distance = hitTestStyleSceneGeometry(element.hitGeometry, [x, y]);
    if (distance == null) continue;
    if (
      !best ||
      element.priority > best.element.priority ||
      (element.priority === best.element.priority && distance < best.distance)
    ) {
      best = { element, distance };
    }
  }
  return best;
}

/** Convert one pointer gesture into one bounded semantic-token patch. */
export function resolveStyleSceneHandleDrag(
  handle: StyleSceneHandle,
  drag: StyleSceneHandleDrag,
  resolveMetadata: (
    semanticId: string,
  ) => StyleSceneTokenDragMetadata | null | undefined = () => null,
): StyleSceneTokenPatch | null {
  if (handle.editability.state !== "editable" || !handle.binding) return null;
  let deltaPixels: number;
  if (handle.kind === "radial") {
    const startRadius = Math.hypot(
      drag.start[0] - handle.center[0],
      drag.start[1] - handle.center[1],
    );
    const currentRadius = Math.hypot(
      drag.current[0] - handle.center[0],
      drag.current[1] - handle.center[1],
    );
    deltaPixels = currentRadius - startRadius;
  } else {
    deltaPixels =
      (drag.current[0] - drag.start[0]) * handle.axis[0] +
      (drag.current[1] - drag.start[1]) * handle.axis[1];
  }

  const metadata = resolveMetadata(handle.binding.semanticId) ?? {};
  let value = handle.binding.value + deltaPixels * handle.binding.valuePerPixel;
  if (metadata.min != null) value = Math.max(metadata.min, value);
  if (metadata.max != null) value = Math.min(metadata.max, value);
  if (metadata.step && metadata.step > 0) {
    const origin = metadata.min ?? 0;
    value = origin + Math.round((value - origin) / metadata.step) * metadata.step;
  }
  if (!Number.isFinite(value)) return null;
  return {
    semanticId: handle.binding.semanticId,
    cssVar: handle.binding.cssVar,
    value: Number(value.toFixed(6)),
  };
}
