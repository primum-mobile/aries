// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/i18n";
import type { SettingsSearchResult } from "@/lib/settings-search";

type SearchProps = {
  query: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  resultsId: string;
  searching: boolean;
  results: SettingsSearchResult[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onQueryChange: (query: string) => void;
  onSelect: (result: SettingsSearchResult) => void;
};

export function SettingsHeader({
  nativeWindow, query, inputRef, resultsId, searching, results, activeIndex, setActiveIndex, onQueryChange, onSelect,
}: SearchProps & { nativeWindow: boolean }) {
  const t = useT();
  const dragRegion = nativeWindow ? "" : undefined;
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      onQueryChange("");
    }
    if (!searching || results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown"
        ? Math.min(activeIndex + 1, results.length - 1)
        : Math.max(activeIndex - 1, 0);
      setActiveIndex(next);
      document.getElementById(`${resultsId}-${next}`)?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onSelect(results[activeIndex]);
    }
  };

  return (
    <DialogHeader data-tauri-drag-region={dragRegion} className="shrink-0 flex-row items-center justify-between select-none border-b border-border/40 px-[var(--aries-dialog-padding)] pb-[var(--aries-pane-header-padding-y)] pt-[var(--aries-dialog-padding)] pr-[calc(var(--aries-dialog-close-inset)+var(--aries-control-height-small)+var(--aries-dialog-header-gap))]">
      <DialogTitle data-tauri-drag-region={dragRegion} className="min-w-0 text-[length:var(--aries-font-size-large)] font-medium tracking-tight">
        {t("settings.title")}
      </DialogTitle>
      <div className="relative min-w-0 w-[calc(var(--aries-control-min-width)*2.25)] shrink">
        <Search aria-hidden="true" className="pointer-events-none absolute left-[var(--aries-control-gap)] top-1/2 size-[var(--aries-control-icon-size-xs)] -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={t("settings.searchField")}
          aria-autocomplete="list"
          aria-expanded={searching}
          aria-controls={searching ? resultsId : undefined}
          aria-activedescendant={searching && results.length ? `${resultsId}-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("settings.searchField")}
          value={query}
          className={`h-[var(--aries-control-height-compact)] pl-[calc(var(--aries-control-icon-size-xs)+2*var(--aries-control-gap))] text-[length:var(--aries-font-size-base)] ${query ? "pr-[var(--aries-control-height-compact)]" : "pr-[var(--aries-control-gap)]"}`}
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <Button type="button" size="icon-xs" variant="ghost"
            className="absolute right-0 top-1/2 -translate-y-1/2"
            aria-label={t("search.clear")} onClick={() => { onQueryChange(""); inputRef.current?.focus(); }}>
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
    </DialogHeader>
  );
}

export function SettingsSearchResults({
  resultsId, results, activeIndex, onSelect,
}: Pick<SearchProps, "resultsId" | "results" | "activeIndex" | "onSelect">) {
  const t = useT();
  return (
    <div className="p-[var(--aries-dialog-padding)]">
      <div id={resultsId} role="listbox" aria-label={t("settings.searchField")}>
        {results.map((result, index) => (
          <button
            key={result.id}
            id={`${resultsId}-${index}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={index === activeIndex}
            onClick={() => onSelect(result)}
            className="flex w-full flex-col items-start gap-[var(--aries-control-gap-compact)] rounded-[var(--aries-radius-menu-item)] px-[var(--aries-tabs-rail-trigger-padding-x)] py-[var(--aries-tabs-rail-trigger-padding-y)] text-start text-[length:var(--aries-font-size-base)] hover:bg-accent aria-selected:bg-accent"
          >
            <span>{result.label}</span>
            {result.path.length > 0 && (
              <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">{result.path.join(" › ")}</span>
            )}
          </button>
        ))}
      </div>
      {results.length === 0 && <p role="status" className="text-muted-foreground">{t("settings.noSearchResults")}</p>}
    </div>
  );
}
