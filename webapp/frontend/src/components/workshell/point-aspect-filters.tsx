// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";
import { AspectSelectionBar } from "./aspect-selection-bar";
import { ListSegmentedControl } from "./list-controls";
import type { PointRoleSide } from "@/lib/point-role-selection";

/** Secondary Directions' filter layout, shared without caller styling overrides. */
export function PointAspectFilters<Id extends string | number>({
  pointLabel, noPointsSelected, allPointsSelected, onClearPoints, onSelectAllPoints,
  aspects, selectedAspectIds, onToggleAspect, onAllAspects, onMajorAspects, onClearAspects,
  children, pointRoleEditor,
}: {
  pointLabel: string;
  pointRoleEditor?: {
    side: PointRoleSide;
    fromCount: number;
    toCount: number;
    onChange: (side: PointRoleSide) => void;
  };
  noPointsSelected: boolean;
  allPointsSelected: boolean;
  onClearPoints: () => void;
  onSelectAllPoints: () => void;
  aspects: readonly { id: Id; label: string; glyph: string }[];
  selectedAspectIds: readonly Id[];
  onToggleAspect: (id: Id) => void;
  onAllAspects: () => void;
  onMajorAspects: () => void;
  onClearAspects: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-[var(--aries-control-gap)]">
          <span className="min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">{pointLabel}</span>
          {pointRoleEditor ? <ListSegmentedControl
            label={t("listFilters.editRole")}
            value={pointRoleEditor.side}
            onChange={pointRoleEditor.onChange}
            options={[
              { value: "from", label: t("listFilters.fromCount", { count: pointRoleEditor.fromCount }) },
              { value: "to", label: t("listFilters.toCount", { count: pointRoleEditor.toCount }) },
            ]}
          /> : null}
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]"
              disabled={noPointsSelected} onClick={onClearPoints}>
              {t("listFilters.deselectAll")}
            </Button>
            <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]"
              disabled={allPointsSelected} onClick={onSelectAllPoints}>
              {t("listFilters.selectAll")}
            </Button>
          </div>
        </div>
        {children}
      </div>
      <section className="grid gap-[var(--aries-control-gap)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--aries-control-gap)]">
          <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">{t("search.aspects")}</span>
          <div className="flex flex-wrap items-center justify-end gap-[var(--aries-control-gap-compact)]">
            <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]" onClick={onAllAspects}>{t("search.all")}</Button>
            <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]" onClick={onMajorAspects}>{t("search.major")}</Button>
            <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]" onClick={onClearAspects}>{t("search.clear")}</Button>
          </div>
        </div>
        <AspectSelectionBar label={t("search.aspects")} items={aspects} selectedIds={selectedAspectIds} onToggle={onToggleAspect} />
      </section>
    </div>
  );
}
