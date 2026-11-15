// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HoverRegion } from "@/stores/workspace-store";

/** Shared semantic object identity for Inspector panels, readings and hover flags. */
export function regionObjectId(region: HoverRegion): string | null {
  if (region.kind === "planet") return String(region.seId);
  if (region.kind === "vertex") return "vertex";
  if (region.kind === "fortune") return "fortune";
  if (region.kind === "syzygy") return "syzygy";
  if (region.kind === "eclipse") return "eclipse";
  if (region.kind === "angle") return region.angleId;
  if (region.kind === "house") return String(region.houseIndex);
  if (region.kind === "sign") return String(region.signIndex);
  if (region.kind === "term") return `${region.signIndex}:${region.rulerSeId}`;
  if (region.kind === "decan") return `${region.signIndex}:${region.decanIndex}`;
  // Daemon rebuilds graphchart's secondary_ring data dict from family +
  // longitude (fixstar nature / formula lookup) + label (title).
  if (region.kind === "secondary_ring") {
    return `${region.family}|${region.longitude}|${region.label}${region.starCode ? `|${region.starCode}` : ""}`;
  }
  // Daemon recomputes the Asp via the same accessors export_aspects used.
  if (region.kind === "aspect") {
    if (region.contactId) return `contact:${region.contactId}`;
    if (region.scope === "interchart") {
      return `interchart:${region.p1}:${region.p2}:${region.aspectType}`;
    }
    return `${region.p1}:${region.p2}:${region.aspectType}`;
  }
  if (region.kind === "drishti") return region.relationId;
  if (region.kind === "declination") return region.partner != null ? `${region.seId}:${region.partner}` : String(region.seId);
  return null;
}
