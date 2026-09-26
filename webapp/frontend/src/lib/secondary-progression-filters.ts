// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SecondaryDirectionRow } from "@/lib/daemon/client";
import type { SecondaryDirectionsPayload, SidebarListPreferencesPayload } from "@/lib/daemon/client";
import type { PointRoleSelection } from "./point-role-selection";

type SecondaryPoint = NonNullable<SecondaryDirectionsPayload["meta"]["filterPoints"]>[number];

/** Resolve old actor choices against the daemon's complete role catalog. */
export function resolveSecondaryPointRoles(points: readonly SecondaryPoint[], preferences: Partial<SidebarListPreferencesPayload["secondaryProgressions"]> | null): PointRoleSelection {
  if (preferences?.pointRoles) return preferences.pointRoles;
  const fromIds = points.filter((point) => {
    if (!point.from) return false;
    if (point.id.startsWith("angle:")) {
      return preferences?.angleIds == null || preferences.angleIds.includes(point.id);
    }
    return preferences?.planetIds == null
      ? point.groupId !== "asteroid"
      : point.planetId != null && preferences.planetIds.includes(point.planetId);
  }).map((point) => point.id);
  return { fromIds, toIds: points.filter((point) => point.to && point.groupId !== "asteroid" && point.groupId !== "house_cusp" && point.id !== "angle:dsc" && point.id !== "angle:ic").map((point) => point.id) };
}

export function secondaryPointRolesMatch(fields: SecondaryDirectionRow["fields"], from: ReadonlySet<string>, to: ReadonlySet<string>): boolean {
  if (!fields.promObjectId || !from.has(fields.promObjectId)) return false;
  // Stations and ingresses describe one actor without a receiving point.
  return fields.sigObjectId == null || to.has(fields.sigObjectId);
}

/** Filter only the acting endpoint; a receiving angle never changes membership. */
export function secondaryActingPointMatches(
  fields: SecondaryDirectionRow["fields"],
  planets: ReadonlySet<number> | null,
  angles: ReadonlySet<string> | null,
): boolean {
  if (fields.promAngleId != null) {
    return angles == null || angles.has(fields.promAngleId);
  }
  return fields.promPlanet != null &&
    (planets == null || planets.has(fields.promPlanet));
}
