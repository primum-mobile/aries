// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Inline catalogue search in the Asteroids table toolbar: type a name or MPC
// number and toggle the asteroid into the canonical selection without opening
// Settings. Uses the same daemon catalogue, install and options contracts as
// the Settings Asteroids tab; the table refreshes from the options event.

import * as React from "react";
import { Check, LoaderCircle, Search, Settings } from "lucide-react";

import {
  fetchAsteroidCatalog,
  fetchOptions,
  installAsteroidEphemeris,
  patchOptions,
  type AsteroidCatalogRow,
  type OptionsAsteroids,
} from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";

const RESULT_LIMIT = 40;

export function AsteroidTableSearch({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const t = useT();
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [catalogRows, setRows] = React.useState<AsteroidCatalogRow[]>([]);
  const [active, setActive] = React.useState(0);
  const [asteroids, setAsteroids] = React.useState<OptionsAsteroids | null>(null);
  const [busy, setBusy] = React.useState<number | null>(null);
  const [failed, setFailed] = React.useState<number | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const listId = React.useId();
  const trimmed = query.trim();
  const rows = trimmed ? catalogRows : [];

  // Re-read the canonical selection on each focus; Settings may have changed it.
  const loadSelection = React.useCallback(() => {
    fetchOptions()
      .then((payload) => setAsteroids(payload.asteroids))
      .catch((error) => console.error("[asteroid-table-search]", error));
  }, []);

  React.useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchAsteroidCatalog(trimmed, controller.signal)
        .then((payload) => {
          setRows(payload.rows.slice(0, RESULT_LIMIT));
          setActive(0);
        })
        .catch((error) => {
          if ((error as { name?: string }).name !== "AbortError") {
            console.error("[asteroid-catalog]", error);
          }
        });
    }, 140);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const selected = React.useMemo(() => new Set(asteroids?.selectedNumbers ?? []), [asteroids]);
  const full = asteroids ? selected.size >= asteroids.maxSelected : false;

  const toggle = async (row: AsteroidCatalogRow) => {
    if (!asteroids || busy !== null) return;
    const isSelected = selected.has(row.number);
    if (!isSelected && full) return;
    setBusy(row.number);
    setFailed(null);
    try {
      if (!isSelected && !row.installed) {
        await installAsteroidEphemeris(row.number);
        setRows((current) => current.map((item) => (
          item.number === row.number ? { ...item, installed: true } : item
        )));
      }
      const numbers = isSelected
        ? asteroids.selectedNumbers.filter((number) => number !== row.number)
        : [...asteroids.selectedNumbers, row.number];
      const payload = await patchOptions({ asteroids: { selectedNumbers: numbers } });
      setAsteroids(payload.asteroids);
    } catch (error) {
      console.error("[asteroid-table-search]", error);
      setFailed(row.number);
    } finally {
      setBusy(null);
    }
  };

  const showPopup = open && (rows.length > 0 || failed !== null);
  const placeholder = t("settings.searchAsteroidNameOrNumber");

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="flex h-[var(--aries-control-height-compact)] w-[13rem] max-w-full items-center gap-[var(--aries-control-gap-compact)] rounded-[var(--aries-radius-control-compact)] border border-transparent px-[var(--aries-control-icon-padding-x-compact)] text-[color:var(--aries-text-muted)] hover:border-[color:var(--aries-border-subtle)] focus-within:border-[color:var(--aries-border-subtle)] focus-within:text-[color:var(--aries-text-primary)]">
        <Search className="size-[var(--aries-control-icon-size)] shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <input
          data-aries-control-appearance="local"
          type="text"
          role="combobox"
          aria-expanded={showPopup}
          aria-controls={listId}
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          className="min-w-0 flex-1 bg-transparent text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)] outline-none placeholder:text-[color:var(--aries-text-muted)]"
          onFocus={() => { setOpen(true); loadSelection(); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setFailed(null); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && rows.length) {
              event.preventDefault();
              setActive((index) => Math.min(rows.length - 1, index + 1));
            } else if (event.key === "ArrowUp" && rows.length) {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter" && rows[active]) {
              event.preventDefault();
              void toggle(rows[active]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (query) setQuery("");
              else { setOpen(false); event.currentTarget.blur(); }
            }
          }}
        />
      </div>
      {showPopup ? (
        <div
          id={listId}
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 flex max-h-[20rem] w-[18rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[var(--aries-radius-popover)] bg-[var(--aries-popover-background)] p-[var(--aries-menu-padding)] text-[color:var(--aries-popover-text)] shadow-md ring-1 ring-foreground/10"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((row, index) => {
              const checked = selected.has(row.number);
              const disabled = !asteroids || (busy !== null && busy !== row.number) || (!checked && full);
              return (
                <button
                  key={row.number}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  disabled={disabled}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => void toggle(row)}
                  className={cn(
                    "flex w-full items-center gap-[var(--aries-menu-item-gap)] rounded-[var(--aries-radius-menu-item)] px-[var(--aries-menu-item-padding-x)] py-[var(--aries-menu-item-padding-y)] text-left text-[length:var(--aries-font-size-control)] disabled:opacity-50",
                    index === active && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="flex size-[var(--aries-menu-icon-size)] shrink-0 items-center justify-center">
                    {busy === row.number
                      ? <LoaderCircle className="size-[var(--aries-menu-icon-size)] animate-spin" aria-hidden="true" />
                      : checked ? <Check className="size-[var(--aries-menu-icon-size)]" aria-hidden="true" /> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-[color:var(--aries-text-muted)]">{row.number}</span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                </button>
              );
            })}
          </div>
          {failed !== null ? (
            <p role="alert" className="px-[var(--aries-menu-item-padding-x)] py-[var(--aries-menu-item-padding-y)] text-[length:var(--aries-font-size-small)] text-destructive">
              {t("settings.asteroidInstallFailed", { number: failed })}
            </p>
          ) : null}
          {onOpenSettings && rows.length > 0 ? (
            <button
              type="button"
              onClick={() => { setOpen(false); onOpenSettings(); }}
              className={cn(
                "flex w-full items-center gap-[var(--aries-menu-item-gap)] rounded-[var(--aries-radius-menu-item)] px-[var(--aries-menu-item-padding-x)] py-[var(--aries-menu-item-padding-y)] text-left text-[length:var(--aries-font-size-control)] text-[color:var(--aries-text-muted)] hover:bg-accent hover:text-accent-foreground",
                "mt-[var(--aries-menu-padding)] border-t border-[color:var(--aries-border-subtle)]",
              )}
            >
              <Settings className="size-[var(--aries-menu-icon-size)] shrink-0" strokeWidth={1.5} aria-hidden="true" />
              {t("table.asteroidSettings")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
