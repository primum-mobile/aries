// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";
import { AspectSelectionBar } from "./aspect-selection-bar";
import { ListSegmentedControl } from "./list-controls";
import type { PointRoleSide } from "@/lib/point-role-selection";

export type PointFilterSection = {
  key: string;
  label: string;
  /** Transit's From/To switch: one chooser edits the exposed side. */
  roleEditor?: {
    side: PointRoleSide;
    fromCount: number;
    toCount: number;
    onChange: (side: PointRoleSide) => void;
  };
  noneSelected: boolean;
  /** The section already matches the daemon's list default. */
  isDefault: boolean;
};

/** Point sections (heading, bulk actions, choices) above the joined aspect bar; no caller styling overrides. */
export function PointAspectFilters<Id extends string | number>({
  sections, renderChoices, onClearSection, onDefaultSection,
  aspects, selectedAspectIds, onToggleAspect, onAllAspects, onMajorAspects, onClearAspects,
}: {
  sections: readonly PointFilterSection[];
  /** The point choices under one section heading. */
  renderChoices: (key: string) => ReactNode;
  onClearSection: (key: string) => void;
  /** Restore the section's default points (planets, Chiron, North Node, Asc, MC). */
  onDefaultSection: (key: string) => void;
  aspects: readonly { id: Id; label: string; glyph: string }[];
  selectedAspectIds: readonly Id[];
  onToggleAspect: (id: Id) => void;
  onAllAspects: () => void;
  onMajorAspects: () => void;
  onClearAspects: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <section key={section.key} aria-label={section.label} className="flex flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-[var(--aries-control-gap)]">
            <span className="min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">{section.label}</span>
            {section.roleEditor ? <ListSegmentedControl
              label={t("listFilters.editRole")}
              value={section.roleEditor.side}
              onChange={section.roleEditor.onChange}
              options={[
                { value: "from", label: t("listFilters.fromCount", { count: section.roleEditor.fromCount }) },
                { value: "to", label: t("listFilters.toCount", { count: section.roleEditor.toCount }) },
              ]}
            /> : null}
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]"
                disabled={section.noneSelected} onClick={() => onClearSection(section.key)}>
                {t("listFilters.deselectAll")}
              </Button>
              <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]"
                disabled={section.isDefault} onClick={() => onDefaultSection(section.key)}>
                {t("listFilters.default")}
              </Button>
            </div>
          </div>
          {renderChoices(section.key)}
        </section>
      ))}
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
