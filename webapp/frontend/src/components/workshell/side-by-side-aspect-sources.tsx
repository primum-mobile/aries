// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SplitAspectSelection, SplitAspectSource } from "@/lib/chart/types";
import { useT } from "@/lib/i18n/i18n";
import { LIST_BUTTON_PROPS, LIST_PANE_CLASSES } from "@/lib/list-tokens";
import { cn } from "@/lib/utils";
import { useSideBySideCommand } from "./side-by-side-charts";

export function SideBySideAspectSources({ selection }: { selection: SplitAspectSelection }) {
  const t = useT();
  const command = useSideBySideCommand();
  if (selection.sources.length < 2) return null;
  const label = (source: SplitAspectSource) =>
    [t(`chartview.${source.side}`), source.ringIndex, source.label].join(" · ");
  return (
    <div className={LIST_PANE_CLASSES.controlRow}>
      {(["primary", "outer"] as const).map((role) => {
        const sourceId = role === "primary" ? selection.primarySourceId : selection.outerSourceId;
        const selected = selection.sources.find((source) => source.id === sourceId);
        const title = t(role === "primary" ? "aspectList.referenceChart" : "aspectList.comparisonChart");
        return (
          <div key={role} className={cn(LIST_PANE_CLASSES.labeledControl, "min-w-0 max-w-full")}>
            <span className={LIST_PANE_CLASSES.controlLabel}>{title}</span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button {...LIST_BUTTON_PROPS.command} className="min-w-0 shrink" aria-label={title} title={selected ? label(selected) : title} />}>
                <span className="truncate">{selected ? label(selected) : title}</span>
                <ChevronDown aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={sourceId ?? ""}>
                  {selection.sources.map((source) => (
                    <DropdownMenuRadioItem key={source.id} value={source.id} label={label(source)} closeOnClick className="whitespace-normal"
                      onClick={() => {
                        if (source.id === sourceId) return;
                        command({ aspectPair: {
                          primary: role === "primary" ? source.id : selection.primarySourceId,
                          outer: role === "outer" ? source.id : selection.outerSourceId,
                        } });
                      }}>
                      {label(source)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </div>
  );
}
