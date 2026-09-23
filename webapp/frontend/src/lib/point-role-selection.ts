// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type PointRoleSide = "from" | "to";
export type PointRoleSelection = { fromIds: string[]; toIds: string[] };

/** Moon, Arabic Parts, fixed stars, and asteroids stay explicit choices in All. */
export function pointRoleSelectAllIds(points: readonly { id: string; groupId: string; from: boolean; to: boolean }[], side: PointRoleSide): string[] {
  return points.filter((point) => point[side]
    && point.id !== "planet:moon"
    && point.groupId !== "part"
    && point.groupId !== "fixed_star"
    && point.groupId !== "asteroid").map((point) => point.id);
}

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
