// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LIST_ROW_CLASSES } from "@/lib/list-tokens";
import { cn } from "@/lib/utils";

/** The joined glyph strip used by Secondary Directions and Transits. */
export function AspectSelectionBar<Id extends string | number>({ items, selectedIds, onToggle, label }: {
  items: readonly { id: Id; label: string; glyph: string }[];
  selectedIds: readonly Id[];
  onToggle: (id: Id) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid w-full overflow-hidden rounded-md border border-border"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}
    >
      {items.map((aspect, index) => (
        <Tooltip key={aspect.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={aspect.label}
                aria-pressed={selectedIds.includes(aspect.id)}
                onClick={() => onToggle(aspect.id)}
                className={cn(
                  "flex h-6 items-center justify-center text-[length:var(--aries-font-size-control)]",
                  LIST_ROW_CLASSES.hover,
                  index !== items.length - 1 && "border-r border-border",
                  selectedIds.includes(aspect.id) && "bg-primary/20 text-primary",
                )}
              />
            }
          >
            <span aria-hidden className="font-symbols">{aspect.glyph}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{aspect.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
