// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SecondaryDirectionRow } from "@/lib/daemon/client";
import type { SecondaryDirectionsPayload, SidebarListPreferencesPayload } from "@/lib/daemon/client";
import type { PointRoleSelection } from "./point-role-selection";

type SecondaryPoint = NonNullable<SecondaryDirectionsPayload["meta"]["filterPoints"]>[number];

/** The daemon's default roles: planets, Chiron, North Node, Asc and MC where supported; the rest stay explicit. */
export function secondaryDefaultPointRoles(points: readonly SecondaryPoint[]): PointRoleSelection {
  return {
    fromIds: points.filter((point) => point.from && point.defaultFrom === true).map((point) => point.id),
    toIds: points.filter((point) => point.to && point.defaultTo === true).map((point) => point.id),
  };
}

/** Resolve saved roles, then legacy actor choices, against the daemon's complete role catalog. */
export function resolveSecondaryPointRoles(points: readonly SecondaryPoint[], preferences: Partial<SidebarListPreferencesPayload["secondaryProgressions"]> | null): PointRoleSelection {
  if (preferences?.pointRoles) return preferences.pointRoles;
  const defaults = secondaryDefaultPointRoles(points);
  if (preferences?.planetIds == null && preferences?.angleIds == null) return defaults;
  const fromIds = points.filter((point) => {
    if (!point.from) return false;
    if (point.id.startsWith("angle:")) {
      return preferences?.angleIds == null || preferences.angleIds.includes(point.id);
    }
    return preferences?.planetIds == null
      ? point.defaultFrom === true
      : point.planetId != null && preferences.planetIds.includes(point.planetId);
  }).map((point) => point.id);
  return { fromIds, toIds: defaults.toIds };
}

/** Order-insensitive comparison of two selections restricted to the ids a side can take. */
export function sameRoleIds(selected: readonly string[], reference: readonly string[], available: ReadonlySet<string>): boolean {
  const a = new Set(selected.filter((id) => available.has(id)));
  const b = new Set(reference.filter((id) => available.has(id)));
  return a.size === b.size && [...a].every((id) => b.has(id));
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
