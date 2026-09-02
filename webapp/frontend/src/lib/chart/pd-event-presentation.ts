// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PdRingPresentation } from "./pd-ring-presentation";
import type {
  PdEventDirectedAnglePrimitive,
  PdEventDirectionRayPrimitive,
  PdEventDisplayFrame,
  PdEventOverlayV1,
  PdEventPrimitive,
  PdEventSourceRole,
  PdEventTrack,
} from "./types";

type UnknownRecord = Record<string, unknown>;

export type PdEventPoint = readonly [number, number];

export interface PdEventLayoutGeometry {
  center: PdEventPoint;
  ascendantDegrees: number;
  outerRayInnerRadius: number;
  outerRayOuterRadius: number;
  innerMarkerInnerRadius: number;
  innerMarkerOuterRadius: number;
  innerMarkerLabelRadius: number;
  outerMarkerLabelRadius: number;
}

export interface PdEventPrimitiveLayout {
  primitiveKind: PdEventPrimitive["kind"];
  partyRole: PdEventPrimitive["role"];
  motion: PdEventPrimitive["motion"];
  sourceRole: PdEventSourceRole;
  track: PdEventTrack;
  longitude: number;
  nativeCoordinate: number;
  angleId: number | null;
  start: PdEventPoint;
  end: PdEventPoint;
}

export interface PdEventLayout {
  eventId: string;
  eventKind: PdEventOverlayV1["eventKind"];
  displayFrame: PdEventDisplayFrame;
  direction: "direct" | "converse";
  exactNow: boolean;
  residualDegrees: number | null;
  promissorColor: string | null;
  significatorColor: string | null;
  directionRay: PdEventPrimitiveLayout;
  directedAngle: PdEventPrimitiveLayout;
  directedAngleLabel: {
    angleId: number;
    text: "AC" | "DC" | "MC" | "IC";
    anchor: PdEventPoint;
  } | null;
}

function normalize(value: number): number {
  return ((value % 360) + 360) % 360;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePoint(point: PdEventPoint): boolean {
  return isFiniteNumber(point[0]) && isFiniteNumber(point[1]);
}

function finiteGeometry(geometry: PdEventLayoutGeometry): boolean {
  if (
    !geometry
    || !Array.isArray(geometry.center)
    || geometry.center.length !== 2
    || !finitePoint(geometry.center)
    || !isFiniteNumber(geometry.ascendantDegrees)
  ) return false;
  const radii = [
    geometry.outerRayInnerRadius,
    geometry.outerRayOuterRadius,
    geometry.innerMarkerInnerRadius,
    geometry.innerMarkerOuterRadius,
    geometry.innerMarkerLabelRadius,
    geometry.outerMarkerLabelRadius,
  ];
  if (!radii.every((radius) => isFiniteNumber(radius) && radius >= 0)) {
    return false;
  }
  return geometry.outerRayOuterRadius !== geometry.outerRayInnerRadius
    && geometry.innerMarkerOuterRadius !== geometry.innerMarkerInnerRadius;
}

function polar(
  center: PdEventPoint,
  radius: number,
  longitude: number,
  ascendantDegrees: number,
): PdEventPoint {
  const radians = Math.PI + ((ascendantDegrees - longitude) * Math.PI) / 180;
  return [
    center[0] + Math.cos(radians) * radius,
    center[1] + Math.sin(radians) * radius,
  ];
}

function isDirectionRayPrimitive(
  primitive: unknown,
): primitive is PdEventDirectionRayPrimitive {
  return isRecord(primitive)
    && primitive.kind === "direction-ray"
    && (primitive.role === "promissor" || primitive.role === "significator")
    && (primitive.motion === "fixed" || primitive.motion === "moving")
    && (primitive.ring === "inner" || primitive.ring === "outer")
    && isFiniteNumber(primitive.longitude)
    && isFiniteNumber(primitive.latitude)
    && isFiniteNumber(primitive.nativeCoordinate)
    && typeof primitive.nativeCoordinateKind === "string";
}

function isDirectedAnglePrimitive(
  primitive: unknown,
): primitive is PdEventDirectedAnglePrimitive {
  return isRecord(primitive)
    && primitive.kind === "directed-angle"
    && (primitive.role === "promissor" || primitive.role === "significator")
    && (primitive.motion === "fixed" || primitive.motion === "moving")
    && (primitive.ring === "inner" || primitive.ring === "outer")
    && isFiniteNumber(primitive.angleId)
    && isFiniteNumber(primitive.longitude)
    && isFiniteNumber(primitive.latitude)
    && isFiniteNumber(primitive.nativeCoordinate)
    && typeof primitive.nativeCoordinateKind === "string";
}

function sourceRoleFor(
  frame: PdEventDisplayFrame,
  primitive: PdEventPrimitive,
): PdEventSourceRole | null {
  if (frame === "fixed-radix") {
    if (
      primitive.ring === "outer"
      && primitive.motion === "moving"
    ) return "outer";
    if (
      primitive.ring === "inner"
      && primitive.motion === "fixed"
    ) return "primary";
    return null;
  }
  if (
    primitive.ring === "outer"
    && primitive.motion === "fixed"
  ) return "primary";
  if (
    primitive.ring === "inner"
    && primitive.motion === "moving"
  ) return "outer";
  return null;
}

function sourceTrack(
  presentation: PdRingPresentation,
  sourceRole: PdEventSourceRole,
): PdEventTrack {
  return sourceRole === "primary"
    ? presentation.primaryBodies.track
    : presentation.comparisonBodies.track;
}

function primitiveLayout(
  primitive: PdEventPrimitive,
  sourceRole: PdEventSourceRole,
  track: PdEventTrack,
  geometry: PdEventLayoutGeometry,
): PdEventPrimitiveLayout {
  const longitude = normalize(primitive.longitude);
  const [innerRadius, outerRadius] = primitive.ring === "outer"
    ? [geometry.outerRayInnerRadius, geometry.outerRayOuterRadius]
    : [geometry.innerMarkerInnerRadius, geometry.innerMarkerOuterRadius];
  return {
    primitiveKind: primitive.kind,
    partyRole: primitive.role,
    motion: primitive.motion,
    sourceRole,
    track,
    longitude,
    nativeCoordinate: normalize(primitive.nativeCoordinate),
    angleId: primitive.kind === "directed-angle" ? primitive.angleId : null,
    start: polar(
      geometry.center,
      innerRadius,
      longitude,
      geometry.ascendantDegrees,
    ),
    end: polar(
      geometry.center,
      outerRadius,
      longitude,
      geometry.ascendantDegrees,
    ),
  };
}

function directedAngleLabel(
  angleId: number,
): "AC" | "DC" | "MC" | "IC" | null {
  // PrimDir.ASC..IC are the stable daemon protocol ids 12..15.
  if (angleId === 12) return "AC";
  if (angleId === 13) return "DC";
  if (angleId === 14) return "MC";
  if (angleId === 15) return "IC";
  return null;
}

function validPrimitivePair(
  eventKind: PdEventOverlayV1["eventKind"],
  directionRay: PdEventDirectionRayPrimitive,
  directedAngle: PdEventDirectedAnglePrimitive,
): boolean {
  if (eventKind === "body-aspect-to-angle") {
    return directionRay.role === "promissor"
      && directionRay.ring === "outer"
      && directedAngle.role === "significator"
      && directedAngle.ring === "inner";
  }
  return directionRay.role === "significator"
    && directionRay.ring === "inner"
    && directedAngle.role === "promissor"
    && directedAngle.ring === "outer";
}

function partyColor(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Convert daemon event primitives to Canvas geometry without redoing any PD
 * calculation. Unsupported or frame-incoherent payloads intentionally vanish.
 */
export function resolvePdEventLayout(
  overlay: PdEventOverlayV1 | null | undefined,
  presentation: PdRingPresentation,
  geometry: PdEventLayoutGeometry,
): PdEventLayout | null {
  const candidate: unknown = overlay;
  if (
    !isRecord(candidate)
    || candidate.schemaVersion !== 1
    || candidate.supported !== true
    || (candidate.eventKind !== "body-aspect-to-angle"
      && candidate.eventKind !== "angle-to-body-aspect")
    || (candidate.displayFrame !== "fixed-radix"
      && candidate.displayFrame !== "traditional-converse")
    || (candidate.direction !== "direct" && candidate.direction !== "converse")
    || typeof candidate.eventId !== "string"
    || candidate.eventId.trim().length === 0
    || typeof candidate.exactNow !== "boolean"
    || !Array.isArray(candidate.primitives)
    || candidate.primitives.length !== 2
    || !isRecord(candidate.parties)
    || !isRecord(candidate.parties.promissor)
    || !isRecord(candidate.parties.significator)
    || !finiteGeometry(geometry)
  ) return null;

  const frame = candidate.displayFrame;
  if (frame === "traditional-converse" && candidate.direction !== "converse") {
    return null;
  }
  if (presentation.traditionalConverse !== (frame === "traditional-converse")) {
    return null;
  }
  const directionRay = candidate.primitives.find(isDirectionRayPrimitive);
  const directedAngle = candidate.primitives.find(isDirectedAnglePrimitive);
  if (
    !directionRay
    || !directedAngle
    || !validPrimitivePair(candidate.eventKind, directionRay, directedAngle)
  ) return null;
  const angleLabel = directedAngleLabel(directedAngle.angleId);
  if (!angleLabel) return null;

  const raySourceRole = sourceRoleFor(frame, directionRay);
  const angleSourceRole = sourceRoleFor(frame, directedAngle);
  if (!raySourceRole || !angleSourceRole) return null;
  const rayTrack = sourceTrack(presentation, raySourceRole);
  const angleTrack = sourceTrack(presentation, angleSourceRole);
  if (
    directionRay.ring !== rayTrack
    || directedAngle.ring !== angleTrack
    || rayTrack === angleTrack
  ) return null;

  const rayLayout = primitiveLayout(
    directionRay,
    raySourceRole,
    rayTrack,
    geometry,
  );
  const angleLayout = primitiveLayout(
    directedAngle,
    angleSourceRole,
    angleTrack,
    geometry,
  );
  const showAngleLabel = candidate.eventKind === "angle-to-body-aspect"
    || frame === "traditional-converse";
  const labelAnchor = showAngleLabel
    ? polar(
        geometry.center,
        directedAngle.ring === "outer"
          ? geometry.outerMarkerLabelRadius
          : geometry.innerMarkerLabelRadius,
        directedAngle.longitude,
        geometry.ascendantDegrees,
      )
    : null;
  if (
    !finitePoint(rayLayout.start)
    || !finitePoint(rayLayout.end)
    || !finitePoint(angleLayout.start)
    || !finitePoint(angleLayout.end)
    || (labelAnchor && !finitePoint(labelAnchor))
  ) return null;
  const residualDegrees = candidate.residualDegrees;
  if (
    residualDegrees !== undefined
    && residualDegrees !== null
    && !isFiniteNumber(residualDegrees)
  ) return null;
  return {
    eventId: candidate.eventId,
    eventKind: candidate.eventKind,
    displayFrame: frame,
    direction: candidate.direction,
    exactNow: candidate.exactNow,
    residualDegrees: residualDegrees ?? null,
    promissorColor: partyColor(candidate.parties.promissor.color),
    significatorColor: partyColor(candidate.parties.significator.color),
    directionRay: rayLayout,
    directedAngle: angleLayout,
    directedAngleLabel: showAngleLabel
      ? {
          angleId: directedAngle.angleId,
          text: angleLabel,
          anchor: labelAnchor!,
        }
      : null,
  };
}
