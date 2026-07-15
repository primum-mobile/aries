// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EventTimeDisplayMeta } from "@/lib/daemon/client";

function normalizedOffsets(meta: EventTimeDisplayMeta): number[] {
  return Array.from(
    new Set(
      meta.offsetsMinutes
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.trunc(value)),
    ),
  ).sort((left, right) => left - right);
}

function baseColumnLabel(columnLabel: string): string {
  return columnLabel.replace(/\s*\([^()]*\)\s*$/u, "").trim();
}

/** Merge adjacent event-list chunks without losing a DST offset represented by
 * rows retained from an earlier chunk. The daemon owns each chunk's localized
 * base label and effective offsets; React only joins the retained metadata. */
export function mergeEventTimeDisplayMeta(
  ...values: Array<EventTimeDisplayMeta | null | undefined>
): EventTimeDisplayMeta | null {
  const metas = values.filter((value): value is EventTimeDisplayMeta => value != null);
  const latest = metas.at(-1);
  if (!latest) return null;

  const offsetsMinutes = Array.from(
    new Set(metas.flatMap((meta) => normalizedOffsets(meta))),
  ).sort((left, right) => left - right);
  const baseLabel = baseColumnLabel(latest.columnLabel);
  const columnLabel = baseLabel || latest.columnLabel;

  return {
    basis: latest.basis,
    zoneId: latest.zoneId,
    offsetsMinutes,
    columnLabel,
  };
}

export function eventListBodyViewportHeight(
  scroller: HTMLDivElement | null,
  fallbackHeight = 0,
): number {
  if (!scroller) return Math.max(0, fallbackHeight);
  const headerHeight = scroller.querySelector<HTMLElement>("thead")?.offsetHeight ?? 0;
  return Math.max(0, scroller.clientHeight - headerHeight);
}
