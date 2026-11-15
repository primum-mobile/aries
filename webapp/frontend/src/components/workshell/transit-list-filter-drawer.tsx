// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";
import type { TransitSearchAspect } from "@/lib/daemon/client";
import { PointAspectFilters } from "./point-aspect-filters";
import { RolePointChooser } from "./role-point-chooser";
import type { PointRoleSide } from "@/lib/point-role-selection";

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

export function TransitListFilterDrawer({ label, items, side, onSideChange, fromIds, toIds, defaultIds, onToggle, onDefault, aspects, selectedAspectIds, onToggleAspect, onSelectAspects }: {
  label: string;
  items: TransitFilterItem[];
  side: PointRoleSide;
  onSideChange: (side: PointRoleSide) => void;
  fromIds: readonly string[];
  toIds: readonly string[];
  /** The daemon's default points for the exposed side. */
  defaultIds: readonly string[];
  onToggle: (ids: string[]) => void;
  /** Restore the exposed side to its default points. */
  onDefault: () => void;
  aspects: TransitSearchAspect[];
  selectedAspectIds: readonly string[];
  onToggleAspect: (id: string) => void;
  onSelectAspects: (ids: string[] | null) => void;
}) {
  const selectedIds = side === "from" ? fromIds : toIds;
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const pointIds = items.filter((item) => item[side]).map((item) => item.id);
  const activeCount = pointIds.filter((id) => selected.has(id)).length;

  return (
    <div role="group" aria-label={label} className="w-full px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-padding-y)]">
      <PointAspectFilters
        sections={[{
          key: "points",
          label,
          roleEditor: { side, onChange: onSideChange, fromCount: fromIds.length, toCount: toIds.length },
          noneSelected: activeCount === 0,
          isDefault: pointIds.every((id) => selected.has(id) === defaultIds.includes(id)),
        }]}
        renderChoices={() => <RolePointChooser items={items} side={side} selected={selected} onToggle={onToggle} />}
        onClearSection={() => onToggle(pointIds.filter((id) => selected.has(id)))}
        onDefaultSection={onDefault}
        aspects={aspects}
        selectedAspectIds={selectedAspectIds}
        onToggleAspect={onToggleAspect}
        onAllAspects={() => onSelectAspects(aspects.map((aspect) => aspect.id))}
        onMajorAspects={() => onSelectAspects(null)}
        onClearAspects={() => onSelectAspects([])}
      />
    </div>
  );
}
