// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import type { GenericTableColumn } from "@/lib/daemon/client";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";

export type ListLayoutPreset = "date-first" | "date-last" | "event-date" | "date-event";

const LIST_LAYOUT_PRESETS: Array<{
  value: ListLayoutPreset;
  labelKey: string;
  titleKey: string;
}> = [
  { value: "date-first", labelKey: "table.presetDateFirst", titleKey: "table.presetDateFirstTitle" },
  { value: "date-last", labelKey: "table.presetDateLast", titleKey: "table.presetDateLastTitle" },
  { value: "event-date", labelKey: "table.presetEventDate", titleKey: "table.presetEventDateTitle" },
  { value: "date-event", labelKey: "table.presetDateEvent", titleKey: "table.presetDateEventTitle" },
];

const LIST_LAYOUT_STORAGE_KEY = "aries.list-layout-preset:v1";
const DEFAULT_LIST_LAYOUT_PRESET: ListLayoutPreset = "event-date";
const LIST_LAYOUT_PRESET_CONTROL_VISIBLE = false;

function isListLayoutPreset(value: unknown): value is ListLayoutPreset {
  return (
    value === "date-first" ||
    value === "date-last" ||
    value === "event-date" ||
    value === "date-event"
  );
}

function readStoredListLayoutPreset(): ListLayoutPreset {
  if (!LIST_LAYOUT_PRESET_CONTROL_VISIBLE) return DEFAULT_LIST_LAYOUT_PRESET;
  if (typeof window === "undefined") return DEFAULT_LIST_LAYOUT_PRESET;
  try {
    const value = window.localStorage.getItem(LIST_LAYOUT_STORAGE_KEY);
    return isListLayoutPreset(value) ? value : DEFAULT_LIST_LAYOUT_PRESET;
  } catch {
    return DEFAULT_LIST_LAYOUT_PRESET;
  }
}

function writeStoredListLayoutPreset(next: ListLayoutPreset): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIST_LAYOUT_STORAGE_KEY, next);
  } catch {
    // The daemon owns semantic state; this cache only preserves local chrome.
  }
}

let listLayoutPreset: ListLayoutPreset = readStoredListLayoutPreset();
const listLayoutListeners = new Set<() => void>();

function subscribeListLayout(listener: () => void) {
  listLayoutListeners.add(listener);
  return () => listLayoutListeners.delete(listener);
}

function getListLayoutSnapshot() {
  return listLayoutPreset;
}

function setListLayoutPreset(next: ListLayoutPreset) {
  if (listLayoutPreset === next) return;
  listLayoutPreset = next;
  writeStoredListLayoutPreset(next);
  listLayoutListeners.forEach((listener) => listener());
}

export function useListLayoutPreset() {
  return React.useSyncExternalStore(subscribeListLayout, getListLayoutSnapshot, getListLayoutSnapshot);
}

export function ListLayoutPresetControl({ className }: { className?: string }) {
  const t = useT();
  const preset = useListLayoutPreset();
  if (!LIST_LAYOUT_PRESET_CONTROL_VISIBLE) return null;
  return (
    <div
      className={cn(
        "inline-flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface)] text-[length:var(--aries-font-size-small)]",
        className,
      )}
      aria-label={t("table.listLayoutPreset")}
    >
      {LIST_LAYOUT_PRESETS.map((option) => (
        <button
          key={option.value}
          type="button"
          title={t(option.titleKey)}
          aria-pressed={preset === option.value}
          className={cn(
            "h-full whitespace-nowrap px-2 tabular-nums text-[color:var(--aries-text-muted)] hover:bg-[color:var(--aries-surface-subtle)]",
            preset === option.value && "bg-[color:var(--aries-surface-subtle)] text-[color:var(--aries-text-primary)]",
          )}
          onClick={() => setListLayoutPreset(option.value)}
        >
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  );
}

export function isListDateColumn(column?: GenericTableColumn): boolean {
  if (!column) return false;
  const id = column.id.toLowerCase();
  const label = column.label.toLowerCase();
  return id === "date" || label === "date";
}

export function isListTimeColumn(column?: GenericTableColumn): boolean {
  if (!column) return false;
  const id = column.id.toLowerCase();
  const label = column.label.toLowerCase();
  return id === "time" || label === "time";
}

export function hasListDateTimeColumns(columns: readonly GenericTableColumn[]): boolean {
  return columns.some((column) => isListDateColumn(column) || isListTimeColumn(column));
}

type DateTimeItem<T> = { date: boolean; item: T };

function orderedDateTime<T>(dateTime: Array<DateTimeItem<T>>): T[] {
  return [...dateTime].sort((a, b) => {
    const aRank = a.date ? 0 : 1;
    const bRank = b.date ? 0 : 1;
    return aRank - bRank;
  }).map(({ item }) => item);
}

function displayOrderByRole<T>(
  items: readonly T[],
  preset: ListLayoutPreset,
  role: (item: T) => "date" | "time" | "event" | "other",
): T[] {
  const dateTimeItems = items
    .filter((item) => role(item) === "date" || role(item) === "time")
    .map((item) => ({ item, date: role(item) === "date" }));
  const dateTime = orderedDateTime(dateTimeItems);
  if (dateTime.length === 0) return [...items];
  const nonDateTime = items.filter((item) => role(item) !== "date" && role(item) !== "time");
  const explicitEvent = nonDateTime.filter((item) => role(item) === "event");
  const event = explicitEvent.length ? explicitEvent : nonDateTime.slice(0, 1);
  const eventSet = new Set(event);
  const other = nonDateTime.filter((item) => !eventSet.has(item));

  switch (preset) {
    case "date-first":
      return [...dateTime, ...nonDateTime];
    case "event-date":
      return [...event, ...dateTime, ...other];
    case "date-event":
      return [...dateTime, ...event, ...other];
    case "date-last":
    default:
      return [...nonDateTime, ...dateTime];
  }
}

export function listColumnDisplayOrder(
  columns: readonly GenericTableColumn[],
  preset: ListLayoutPreset,
  eventColumnIds: readonly string[] = [],
): number[] {
  const eventIds = new Set(eventColumnIds.map((id) => id.toLowerCase()));
  const indices = columns.map((_, index) => index);
  return displayOrderByRole(indices, preset, (index) => {
    const column = columns[index];
    if (isListDateColumn(column)) return "date";
    if (isListTimeColumn(column)) return "time";
    if (eventIds.has(column.id.toLowerCase()) || eventIds.has(column.label.toLowerCase())) return "event";
    return "other";
  });
}

export function listKeyDisplayOrder<Key extends string>(
  keys: readonly Key[],
  preset: ListLayoutPreset,
  {
    dateKeys = [],
    timeKeys = [],
    eventKeys = [],
  }: {
    dateKeys?: readonly Key[];
    timeKeys?: readonly Key[];
    eventKeys?: readonly Key[];
  },
): Key[] {
  const dateSet = new Set<Key>(dateKeys);
  const timeSet = new Set<Key>(timeKeys);
  const eventSet = new Set<Key>(eventKeys);
  return displayOrderByRole(keys, preset, (key) => {
    if (dateSet.has(key)) return "date";
    if (timeSet.has(key)) return "time";
    if (eventSet.has(key)) return "event";
    return "other";
  });
}
