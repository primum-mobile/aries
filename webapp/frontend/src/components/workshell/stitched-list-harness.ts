// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { perfNow, recordChartPerf } from "@/lib/chart/perf";

// Shared mechanics for retained, time-windowed sidebar lists. The daemon owns
// row semantics and computes bounded windows; the client stitches adjacent
// windows into one stable scroll surface and filters that retained source.

export type ListSpan = { start: number; end: number };
export type AgeSpan = ListSpan;

export type StitchedRows<T> = {
  rows: T[];
  coverage: ListSpan;
  /** Bump on a long jump or replacement island. Adjacent extension keeps the
   * nonce so loading more rows never reanchors the viewport. */
  islandNonce: number;
};

const SPAN_EPSILON = 0.01;

export function spanContainsAge(span: ListSpan | null | undefined, age: number): boolean {
  return !!span && age >= span.start - SPAN_EPSILON && age <= span.end + SPAN_EPSILON;
}

/** Merge one adjacent chunk and deduplicate the shared boundary by semantic
 * display identity. The caller supplies the identity because refined instants
 * can jitter slightly between independently calculated windows. */
export function stitchRows<T>(
  current: StitchedRows<T>,
  chunkRows: readonly T[],
  chunkSpan: ListSpan,
  keyOf: (row: T) => string,
): { next: StitchedRows<T>; prependedCount: number } {
  const hasGapBefore = chunkSpan.end < current.coverage.start - SPAN_EPSILON;
  const hasGapAfter = chunkSpan.start > current.coverage.end + SPAN_EPSILON;
  if (hasGapBefore || hasGapAfter) {
    throw new Error(
      `Cannot stitch non-adjacent list spans ${chunkSpan.start}:${chunkSpan.end} and ${current.coverage.start}:${current.coverage.end}`,
    );
  }
  const seen = new Set(current.rows.map(keyOf));
  const fresh = chunkRows.filter((row) => !seen.has(keyOf(row)));
  const coverage: ListSpan = {
    start: Math.min(current.coverage.start, chunkSpan.start),
    end: Math.max(current.coverage.end, chunkSpan.end),
  };
  if (chunkSpan.end <= current.coverage.start + SPAN_EPSILON) {
    return {
      next: { rows: [...fresh, ...current.rows], coverage, islandNonce: current.islandNonce },
      prependedCount: fresh.length,
    };
  }
  return {
    next: { rows: [...current.rows, ...fresh], coverage, islandNonce: current.islandNonce },
    prependedCount: 0,
  };
}

/** Stable keys survive prepends. Index keys remount every visible row when an
 * earlier chunk is stitched into the list. */
export function buildStableRowKeys<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): string[] {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const base = keyOf(row);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

/** Apply display-only object toggles to the retained source rows. Keep the
 * unfiltered source in the stitched cache so a toggle is immediate and never
 * creates a new data world or resets the viewport. Null means all; [] means none. */
export function filterRetainedRows<T, Id>(
  sourceRows: readonly T[],
  activeIds: readonly Id[] | null,
  idOf: (row: T) => Id,
): T[] {
  if (activeIds == null) return sourceRows.slice();
  const active = new Set(activeIds);
  return sourceRows.filter((row) => active.has(idOf(row)));
}

/** Convert a source prepend count to the number of currently visible rows so
 * scroll compensation remains exact while display filters are active. */
export function visiblePrependedRowCount<T, Id>(
  stitchedRows: readonly T[],
  prependedCount: number,
  activeIds: readonly Id[] | null,
  idOf: (row: T) => Id,
): number {
  if (prependedCount <= 0) return 0;
  if (activeIds == null) return prependedCount;
  const active = new Set(activeIds);
  return stitchedRows
    .slice(0, prependedCount)
    .filter((row) => active.has(idOf(row))).length;
}

/** rAF-throttled edge watcher over a fixed-row-height scroller. The caller
 * owns in-flight guards, coverage bounds, and chunk size. */
export function useEdgeExtend({
  scrollerRef,
  rowCount,
  thresholdPx,
  canExtendBackward,
  canExtendForward,
  onExtend,
}: {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  rowCount: number;
  thresholdPx: number;
  canExtendBackward: boolean;
  canExtendForward: boolean;
  onExtend: (direction: "previous" | "next") => void;
}) {
  const thresholdPxRef = React.useRef(thresholdPx);
  React.useLayoutEffect(() => {
    thresholdPxRef.current = thresholdPx;
  }, [thresholdPx]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || rowCount <= 0) {
      return undefined;
    }
    let frame = 0;
    let scrollEventAt: number | null = null;
    const check = () => {
      frame = 0;
      // A live profile change translates scrollTop to retain the same visible
      // row. That synthetic scroll must not be mistaken for edge intent.
      const rowHeightAnchorUntil = Number(scroller.dataset.ariesRowHeightAnchorUntil ?? 0);
      if (rowHeightAnchorUntil > Date.now()) return;
      if (scrollEventAt != null) {
        recordChartPerf("list-scroll-frame", {
          rowCount,
          eventToFrameMs: Math.max(0, perfNow() - scrollEventAt),
          scrollTop: Math.round(scroller.scrollTop),
          viewportPx: Math.round(scroller.clientHeight),
        });
        scrollEventAt = null;
      }
      const maxTop = scroller.scrollHeight - scroller.clientHeight;
      if (scroller.clientHeight <= 0 || maxTop <= 0) return;
      if (canExtendBackward && scroller.scrollTop <= thresholdPxRef.current) {
        onExtend("previous");
      } else if (canExtendForward && maxTop - scroller.scrollTop <= thresholdPxRef.current) {
        onExtend("next");
      }
    };
    const schedule = (fromScroll: boolean) => {
      if (!frame) {
        if (fromScroll) scrollEventAt = perfNow();
        frame = requestAnimationFrame(check);
      }
    };
    const onScroll = () => schedule(true);
    schedule(false);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [canExtendBackward, canExtendForward, onExtend, rowCount, scrollerRef]);
}
