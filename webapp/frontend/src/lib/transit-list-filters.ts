// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SidebarListPreferencesPayload, TransitSearchCatalog, TransitSearchMotionFilter } from "./daemon/client";

export type TransitListFilters = {
  promittorIds: string[];
  significatorIds: string[];
  aspects: string[];
  promittorMotion: TransitSearchMotionFilter;
  significatorMotion: TransitSearchMotionFilter;
};

export type TransitListFilterPreferences = Pick<SidebarListPreferencesPayload["transitList"],
  "selectedPointIds" | "selectedAspectIds" | "pointRoles"
>;

function resolveIds(selected: readonly string[] | null | undefined, defaults: readonly string[], available: readonly string[]): string[] {
  const allowed = new Set(available);
  return [...new Set(selected ?? defaults)].filter((id) => allowed.has(id)).sort();
}

/** The daemon declares physical transit roles separately from other Search techniques. */
export function transitPointRoleIds(catalog: TransitSearchCatalog | null, role: "promittor" | "significator"): string[] {
  return catalog?.objects.filter((obj) => obj.transitRoles?.[role] === "supported").map((obj) => obj.id) ?? [];
}

export function resolveTransitPointIds(catalog: TransitSearchCatalog | null, selectedPointIds?: readonly string[] | null): string[] {
  return resolveIds(selectedPointIds,
    [...(catalog?.presets.promittors.standard ?? []), ...(catalog?.presets.significators.standard ?? [])],
    [...transitPointRoleIds(catalog, "promittor"), ...transitPointRoleIds(catalog, "significator")],
  );
}

/** The daemon's list-filter default roles (Transit List Default and Reset). */
export function transitListDefaultRoles(catalog: TransitSearchCatalog | null): { fromIds: string[]; toIds: string[] } {
  return {
    fromIds: resolveIds(catalog?.presets.promittors.listDefault, [], transitPointRoleIds(catalog, "promittor")),
    toIds: resolveIds(catalog?.presets.significators.listDefault, [], transitPointRoleIds(catalog, "significator")),
  };
}

/** The Search catalog owns eligibility; retained choices never rewrite it. */
export function resolveTransitListFilters(catalog: TransitSearchCatalog | null, preferences: Partial<TransitListFilterPreferences>): TransitListFilters {
  // Old single-set choices resolve with their standard natal counterparts;
  // without any saved choice both roles start from the list default. Once
  // edited, the two role selections are independent, including empty sets.
  const legacy = preferences.selectedPointIds == null ? null : resolveTransitPointIds(catalog, preferences.selectedPointIds);
  const defaults = transitListDefaultRoles(catalog);
  const fromDefault = legacy ?? defaults.fromIds;
  const toDefault = legacy == null ? defaults.toIds
    : legacy.length ? [...(catalog?.presets.significators.standard ?? []), ...legacy] : [];
  return {
    promittorIds: resolveIds(preferences.pointRoles?.fromIds ?? fromDefault, [], transitPointRoleIds(catalog, "promittor")),
    significatorIds: resolveIds(preferences.pointRoles?.toIds ?? toDefault, [], transitPointRoleIds(catalog, "significator")),
    aspects: resolveIds(preferences.selectedAspectIds, catalog?.presets.aspects.major ?? [], catalog?.aspects.map((aspect) => aspect.id) ?? []),
    promittorMotion: "",
    significatorMotion: "",
  };
}

export function transitListFilterKey(filters: TransitListFilters): string {
  return JSON.stringify(filters);
}

/** Preserve temporarily unavailable choices when editing the visible selection. */
export function toggleTransitListIds(selected: readonly string[] | null | undefined, effective: readonly string[], ids: readonly string[]): string[] {
  const next = new Set(selected ?? effective);
  const remove = ids.every((id) => next.has(id));
  for (const id of ids) {
    if (remove) next.delete(id);
    else next.add(id);
  }
  return [...next].sort();
}
