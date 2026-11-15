// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";

export type AppliedFilterToken = {
  key: string;
  caption: string;
  value: ReactNode;
};

/**
 * Applied-filter summary for a list header: one token per facet that differs
 * from the daemon default, plus Reset filters. Renders nothing at the default,
 * so a quiet header always means no rows are hidden.
 */
export function AppliedFilterTokens({ tokens, drawerOpen, onToggleDrawer, onRemove, onReset }: {
  tokens: readonly AppliedFilterToken[];
  /** Whether the list's filter drawer is open; a token click toggles it. */
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  /** Returns that one facet to its default. */
  onRemove: (key: string) => void;
  onReset: () => void;
}) {
  const t = useT();
  if (!tokens.length) return null;
  return (
    <div role="group" aria-label={t("listFilters.activeFilters")}
      className="flex min-w-0 flex-wrap items-center gap-[var(--aries-control-gap-compact)]">
      {tokens.map((token) => (
        <span key={token.key}
          className="inline-flex h-6 min-w-0 items-center overflow-hidden rounded-[var(--aries-radius-control)] bg-muted text-[length:var(--aries-font-size-small)]">
          <button type="button" onClick={onToggleDrawer} aria-expanded={drawerOpen}
            title={drawerOpen ? t("search.closeFilters") : t("listFilters.editFilter", { filter: token.caption })}
            aria-label={drawerOpen ? t("search.closeFilters") : t("listFilters.editFilter", { filter: token.caption })}
            className="flex h-full min-w-0 cursor-pointer items-center gap-1 pl-[var(--aries-control-gap)] pr-[var(--aries-control-gap-compact)] transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none">
            <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{token.caption}</span>
            <span className="flex min-w-0 items-center gap-0.5 truncate">{token.value}</span>
          </button>
          <button type="button" onClick={() => onRemove(token.key)}
            title={t("listFilters.removeFilter", { filter: token.caption })}
            aria-label={t("listFilters.removeFilter", { filter: token.caption })}
            className="flex h-full cursor-pointer items-center px-[var(--aries-control-gap-compact)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none">
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      <Button type="button" size="xs" variant="ghost" className="px-[var(--aries-control-gap)]" onClick={onReset}>
        {t("listFilters.resetFilters")}
      </Button>
    </div>
  );
}
