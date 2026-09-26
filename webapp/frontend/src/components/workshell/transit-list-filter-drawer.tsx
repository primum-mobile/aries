// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { TransitSearchAspect } from "@/lib/daemon/client";
import { PointAspectFilters } from "./point-aspect-filters";
import { pointRoleSelectAllIds, type PointRoleSide } from "@/lib/point-role-selection";
import { useT } from "@/lib/i18n/i18n";

export type TransitFilterItem = {
  id: string;
  label: string;
  glyph: string;
  glyphFont?: "morinus" | "text";
  marker?: string;
  groupId: string;
  group: string;
  from: boolean;
  to: boolean;
};

export function TransitListFilterDrawer({ label, items, side, onSideChange, fromIds, toIds, onToggle, aspects, selectedAspectIds, onToggleAspect, onSelectAspects }: {
  label: string;
  items: TransitFilterItem[];
  side: PointRoleSide;
  onSideChange: (side: PointRoleSide) => void;
  fromIds: readonly string[];
  toIds: readonly string[];
  onToggle: (ids: string[]) => void;
  aspects: TransitSearchAspect[];
  selectedAspectIds: readonly string[];
  onToggleAspect: (id: string) => void;
  onSelectAspects: (ids: string[] | null) => void;
}) {
  const t = useT();
  const selectedIds = side === "from" ? fromIds : toIds;
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const groups = React.useMemo(() => {
    const grouped = new Map<string, TransitFilterItem[]>();
    for (const item of items) {
      const groupId = ["part", "fixed_star", "asteroid", "house_cusp"].includes(item.groupId) ? item.groupId : "points";
      const group = grouped.get(groupId) ?? [];
      group.push(item);
      grouped.set(groupId, group);
    }
    return [...grouped];
  }, [items]);
  const pointIds = items.filter((item) => item[side]).map((item) => item.id);
  const selectAllIds = pointRoleSelectAllIds(items, side);
  const activeCount = pointIds.filter((id) => selected.has(id)).length;

  return (
    <div role="group" aria-label={label} className="h-full min-h-0 w-full overflow-auto px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-padding-y)]">
      <PointAspectFilters
        pointLabel={label}
        pointRoleEditor={{ side, onChange: onSideChange, fromCount: fromIds.length, toCount: toIds.length }}
        noPointsSelected={activeCount === 0}
        allPointsSelected={selectAllIds.every((id) => selected.has(id))}
        onClearPoints={() => onToggle(pointIds.filter((id) => selected.has(id)))}
        onSelectAllPoints={() => onToggle(selectAllIds.filter((id) => !selected.has(id)))}
        aspects={aspects}
        selectedAspectIds={selectedAspectIds}
        onToggleAspect={onToggleAspect}
        onAllAspects={() => onSelectAspects(aspects.map((aspect) => aspect.id))}
        onMajorAspects={() => onSelectAspects(null)}
        onClearAspects={() => onSelectAspects([])}
      >
        {/* Keep Circum's point buttons; ordinary points wrap without repeating their labels. */}
        {groups.map(([groupId, choices]) => {
          const group = choices[0].group;
          const available = choices.filter((item) => item[side]);
          const allSelected = available.length > 0 && available.every((item) => selected.has(item.id));
          const anySelected = available.some((item) => selected.has(item.id));
          const pressed = allSelected ? true : anySelected ? "mixed" : false;
          return (
            <div key={groupId} className="flex min-w-0 flex-wrap items-center gap-1.5">
              {groupId === "fixed_star" || groupId === "house_cusp" ? (
                <Button type="button" size="xs" variant={anySelected ? "default" : "outline"}
                  aria-pressed={pressed} disabled={available.length === 0}
                  onClick={() => onToggle(available.map((item) => item.id))}
                  title={groupId === "house_cusp" ? t("styleLab.variant.cusps") : group}
                  aria-label={groupId === "house_cusp" ? t("styleLab.variant.cusps") : group}
                  className="h-6 max-w-44 justify-start gap-1 px-2 text-[length:var(--aries-font-size-small)]">
                  {groupId === "house_cusp" ? t("styleLab.variant.cusps") : group}
                </Button>
              ) : (
                <>
                  {groupId !== "points" ? (
                    <button type="button" aria-pressed={pressed} disabled={available.length === 0}
                      onClick={() => onToggle(available.map((item) => item.id))}
                      className="mr-1 min-w-14 text-left text-[length:var(--aries-font-size-section)] text-muted-foreground">
                      {group}
                    </button>
                  ) : null}
                  {choices.map((item) => (
                    <Button
                      key={item.id} type="button" size="xs"
                      variant={selected.has(item.id) ? "default" : "outline"}
                      aria-pressed={selected.has(item.id)}
                      disabled={!item[side]}
                      onClick={() => onToggle([item.id])}
                      className="h-6 max-w-44 justify-start gap-1 px-2 text-[length:var(--aries-font-size-small)]"
                      title={item.label}
                    >
                      {item.glyph ? <span aria-hidden="true" style={{ fontFamily: item.glyphFont === "text" ? undefined : "AriesMorinus" }}>{item.glyph}</span> : null}
                      <span className="truncate">{item.label}</span>
                      {item.marker ? <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{item.marker}</span> : null}
                    </Button>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </PointAspectFilters>
    </div>
  );
}
