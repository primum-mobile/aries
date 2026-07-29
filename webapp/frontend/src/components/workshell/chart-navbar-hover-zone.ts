// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OverlayOffset } from "@/hooks/use-draggable-overlay";

type NavbarRect = Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

export type ChartNavbarHoverZone = NavbarRect & Readonly<{
  moved: boolean;
  placement: "top" | "bottom";
}>;

const HOVER_SLOP_PX = 18;
const MOVED_EPSILON_PX = 0.5;

let currentZone: ChartNavbarHoverZone | null = null;

export function chartNavbarHoverZoneFromRect(
  rect: NavbarRect,
  offset: OverlayOffset,
  placement: "top" | "bottom",
): ChartNavbarHoverZone {
  return {
    left: rect.left - HOVER_SLOP_PX,
    right: rect.right + HOVER_SLOP_PX,
    top: rect.top - HOVER_SLOP_PX,
    bottom: rect.bottom + HOVER_SLOP_PX,
    moved:
      Math.abs(offset.x) > MOVED_EPSILON_PX ||
      Math.abs(offset.y) > MOVED_EPSILON_PX,
    placement,
  };
}

export function setChartNavbarHoverZone(zone: ChartNavbarHoverZone): void {
  currentZone = zone;
}

export function readChartNavbarHoverZone(): ChartNavbarHoverZone | null {
  return currentZone;
}

export function pointIsInsideChartNavbarHoverZone(
  zone: ChartNavbarHoverZone,
  clientX: number,
  clientY: number,
): boolean {
  return (
    clientX >= zone.left &&
    clientX <= zone.right &&
    clientY >= zone.top &&
    clientY <= zone.bottom
  );
}
