// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type PointRoleSide = "from" | "to";
export type PointRoleSelection = { fromIds: string[]; toIds: string[] };

/** Edit only the exposed side, retaining the other side and unavailable choices. */
export function setPointRoleIds(selection: PointRoleSelection, side: PointRoleSide, ids: readonly string[], enabled: boolean): PointRoleSelection {
  const key = side === "from" ? "fromIds" : "toIds";
  const next = new Set(selection[key]);
  for (const id of ids) {
    if (enabled) next.add(id);
    else next.delete(id);
  }
  return { ...selection, [key]: [...next].sort() };
}

export function togglePointRoleIds(selection: PointRoleSelection, side: PointRoleSide, ids: readonly string[]): PointRoleSelection {
  const selected = selection[side === "from" ? "fromIds" : "toIds"];
  return setPointRoleIds(selection, side, ids, !ids.every((id) => selected.includes(id)));
}
