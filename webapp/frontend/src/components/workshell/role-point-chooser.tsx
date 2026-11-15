// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { PointRoleSide } from "@/lib/point-role-selection";
import { useT } from "@/lib/i18n/i18n";

export type RolePointItem = {
  id: string;
  label: string;
  glyph?: string | null;
  glyphFont?: "morinus" | "text";
  marker?: string;
  groupId: string;
  /** Localized family caption for grouped families (asteroids, parts, stars). */
  group: string;
  from: boolean;
  to: boolean;
};

/**
 * Circum's compact point buttons for one role. Ordinary points wrap together;
 * asteroids and Arabic Parts follow a quiet caption that toggles the family;
 * fixed stars and house cusps collapse to one family button.
 */
export function RolePointChooser({ items, side, selected, onToggle, hideUnsupported = false }: {
  items: readonly RolePointItem[];
  side: PointRoleSide;
  selected: ReadonlySet<string>;
  onToggle: (ids: string[]) => void;
  /** Omit points that cannot take this side's role instead of showing them disabled. */
  hideUnsupported?: boolean;
}) {
  const t = useT();
  const groups = React.useMemo(() => {
    const grouped = new Map<string, RolePointItem[]>();
    for (const item of items) {
      if (hideUnsupported && !item[side]) continue;
      const groupId = ["part", "fixed_star", "asteroid", "house_cusp"].includes(item.groupId) ? item.groupId : "points";
      const group = grouped.get(groupId) ?? [];
      group.push(item);
      grouped.set(groupId, group);
    }
    return [...grouped];
  }, [hideUnsupported, items, side]);
  return groups.map(([groupId, choices]) => {
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
  });
}
