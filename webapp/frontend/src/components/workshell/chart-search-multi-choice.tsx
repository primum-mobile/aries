// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenuCheckboxItem, ContextMenuContent, ContextMenuSeparator } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/i18n";
import type { ChartPickerChoice } from "@/lib/daemon/client";

export function ChartSearchMultiChoice({
  values,
  choices = [],
  ariaLabel,
  anyLabel,
  onChange,
  exclude,
  onExcludeChange,
  disabled,
}: {
  values: string[];
  choices?: ChartPickerChoice[];
  ariaLabel: string;
  anyLabel?: string;
  onChange: (values: string[]) => void;
  exclude?: boolean;
  onExcludeChange?: (exclude: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [filter, setFilter] = React.useState("");
  const options = choices.filter((choice) => choice.value !== "" && choice.value !== "-1");
  const byValue = new Map(options.map((choice) => [choice.value, choice]));
  const selectedChoices: ChartPickerChoice[] = values.map((value) => byValue.get(value)
    ?? { value, label: t("palette.actionUnavailable", { label: value }) });
  const searchable = options.some((choice) => choice.group) || options.length > 50;
  const matching = searchable && filter.trim()
    ? options.filter((choice) => choice.label.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
    : options;
  const visible = [
    ...selectedChoices.filter((choice) => !byValue.has(choice.value)),
    ...options.filter((choice) => values.includes(choice.value) || matching.includes(choice)),
  ];
  const emptyLabel = anyLabel ?? t("picker.any");
  const selected = selectedChoices.map((choice) => choice.label).join(", ") || emptyLabel;
  const label = exclude ? `${t("picker.exclude")}: ${selected}` : selected;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" data-aries-control-appearance="local" />}
        aria-label={ariaLabel}
        disabled={disabled}
        title={label}
        className="flex h-[var(--aries-control-height-small)] min-w-0 items-center justify-between gap-[var(--aries-control-gap-compact)] rounded-[var(--aries-radius-ui-control-compact)] border border-input bg-background px-[var(--aries-control-padding-x-compact)] text-left text-[length:var(--aries-font-size-base)]"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-[var(--aries-control-icon-size-xs)] shrink-0" />
      </DropdownMenuTrigger>
      <ContextMenuContent side="bottom" align="start">
        {onExcludeChange ? (
          <>
            <ContextMenuCheckboxItem checked={!!exclude} closeOnClick={false} onCheckedChange={onExcludeChange}>
              {t("picker.exclude")}
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        {searchable ? <Input value={filter} placeholder={t("picker.search")} aria-label={t("picker.search")}
          onChange={(event) => setFilter(event.target.value)} onKeyDown={(event) => event.stopPropagation()} /> : null}
        <ContextMenuCheckboxItem checked={!values.length} closeOnClick={false} onCheckedChange={() => onChange([])}>
          {emptyLabel}
        </ContextMenuCheckboxItem>
        {visible.map((choice, index) => (
          <React.Fragment key={choice.value}>
            {choice.group && choice.group !== visible[index - 1]?.group ? <ContextMenuSeparator /> : null}
            <ContextMenuCheckboxItem
              checked={values.includes(choice.value)}
              closeOnClick={false}
              onCheckedChange={(checked) => onChange(checked ? [...values, choice.value] : values.filter((value) => value !== choice.value))}
            >
              {choice.label}
            </ContextMenuCheckboxItem>
          </React.Fragment>
        ))}
      </ContextMenuContent>
    </DropdownMenu>
  );
}
