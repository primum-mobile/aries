// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

/** Results keep at least this many CSS px when a drawer opens fully. */
const RESULTS_MIN_PX = 120;
/** Boxes that overlap by less than this still count as separate lines. */
const LINE_OVERLAP_TOLERANCE_PX = 1;
const BOX_SELECTOR = "button, input, select, textarea, svg, img, canvas, [role=radiogroup], [data-sash-line]";

/**
 * Sash stops for a drawer: one per visual line (halfway into the gap below
 * it, so the next line is cleanly absent), ending with the full content
 * height. Boxes are text and control rects measured from the content top;
 * boxes that overlap vertically share a line, so no stop cuts through one.
 */
export function controlLineBoundaries(boxes: ReadonlyArray<{ top: number; bottom: number }>, full: number): number[] {
  const lines: Array<{ top: number; bottom: number }> = [];
  for (const box of [...boxes].sort((a, b) => a.top - b.top)) {
    const line = lines[lines.length - 1];
    if (line && box.top < line.bottom - LINE_OVERLAP_TOLERANCE_PX) line.bottom = Math.max(line.bottom, box.bottom);
    else lines.push({ ...box });
  }
  const bounds = lines.map((line, index) => {
    const next = lines[index + 1]?.top ?? full;
    return Math.min(full, Math.ceil(line.bottom + Math.max(0, next - line.bottom) / 2));
  });
  bounds.push(full);
  return [...new Set(bounds)].filter((bound) => bound > 0).sort((a, b) => a - b);
}

/** The stop a drawer should sit at: its chosen stop, or all of it when none was chosen. */
export function contentFitTarget(bounds: readonly number[], chosenPx: number | null): number {
  if (chosenPx === null) return bounds[bounds.length - 1];
  return bounds.reduce((best, bound) => (Math.abs(bound - chosenPx) < Math.abs(best - chosenPx) ? bound : best), bounds[0]);
}

function lineBoundaries(content: HTMLElement): number[] {
  const top = content.getBoundingClientRect().top;
  const rects: DOMRect[] = Array.from(content.querySelectorAll<HTMLElement>(BOX_SELECTOR), (element) => element.getBoundingClientRect());
  // Captions and labels are plain text; their line boxes count as lines too.
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    rects.push(...Array.from(range.getClientRects()));
  }
  const boxes = rects
    .filter((rect) => rect.height > 0 && rect.width > 0)
    .map((rect) => ({ top: rect.top - top, bottom: rect.bottom - top }));
  return controlLineBoundaries(boxes, content.offsetHeight);
}

/** Group height the panels share: the group minus its sash rules. */
function panelSpace(group: HTMLElement): number {
  let space = group.getBoundingClientRect().height;
  for (const child of Array.from(group.children)) {
    if (child instanceof HTMLElement && child.hasAttribute("data-panel-resize-handle-id")) space -= child.offsetHeight;
  }
  return space;
}

type Limits = { min: number; max: number; results: number };

/**
 * Content-fit sash for a drawer panel inside a vertical ResizablePanelGroup.
 * The drawer opens to all of its content, capped to leave the results their
 * minimum on a whole line. Every release (pointer, keyboard, double-click)
 * settles on a whole line; window or content changes keep the chosen line, or
 * keep fitting the content when the drawer was left at full height. Sizes stay
 * percentages for the panel library; the hook converts from measured CSS px.
 */
export function useContentFitPanel(enabled: boolean) {
  const panelRef = React.useRef<ImperativePanelHandle>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  /** Optional fixed row under the scroller (the close bar); it adds to every stop. */
  const footerRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  /** Chosen stop in CSS px; null fits the whole content. */
  const chosenRef = React.useRef<number | null>(null);
  /** A resize waiting for new min/max props to reach the panel. */
  const pendingRef = React.useRef<number | null>(null);
  const [limits, setLimits] = React.useState<Limits | null>(null);
  const limitsRef = React.useRef<Limits | null>(null);

  const measure = React.useCallback(() => {
    const content = contentRef.current;
    const group = content?.closest<HTMLElement>("[data-panel-group]");
    const panel = panelRef.current;
    if (!content || !group || !panel) return null;
    const space = panelSpace(group);
    if (space <= 0) return null;
    const room = Math.max(0, space - RESULTS_MIN_PX);
    const footer = footerRef.current?.offsetHeight ?? 0;
    const all = lineBoundaries(content).map((bound) => bound + footer);
    const fitting = all.filter((bound) => bound <= room);
    const bounds = fitting.length ? fitting : all.slice(0, 1);
    const pct = (px: number) => Math.min(100, (px / space) * 100);
    const currentPx = (panel.getSize() / 100) * space;
    return { bounds, pct, currentPx };
  }, []);

  const apply = React.useCallback((targetPx: number, measured: NonNullable<ReturnType<typeof measure>>) => {
    const { bounds, pct } = measured;
    const next = { min: pct(bounds[0]), max: pct(bounds[bounds.length - 1]), results: pct(RESULTS_MIN_PX) };
    const same = (a: number, b: number) => Math.abs(a - b) < 0.05;
    const target = pct(targetPx);
    const prev = limitsRef.current;
    if (!prev || !same(prev.min, next.min) || !same(prev.max, next.max) || !same(prev.results, next.results)) {
      // The panel clamps to its current props; resize once the new ones land.
      limitsRef.current = next;
      pendingRef.current = target;
      setLimits(next);
    } else if (Math.abs(targetPx - measured.currentPx) > 0.5) {
      panelRef.current?.resize(target);
    }
  }, []);

  const settle = React.useCallback(() => {
    if (!enabled || draggingRef.current) return;
    const measured = measure();
    if (measured) apply(contentFitTarget(measured.bounds, chosenRef.current), measured);
  }, [enabled, measure, apply]);

  /** Record the stop nearest the current size as the drawer's choice and settle there. */
  const choose = React.useCallback((px: number) => {
    const measured = measure();
    if (!measured) return;
    const { bounds } = measured;
    const snapped = contentFitTarget(bounds, px);
    chosenRef.current = snapped === bounds[bounds.length - 1] ? null : snapped;
    apply(snapped, measured);
  }, [measure, apply]);

  React.useLayoutEffect(() => {
    const target = pendingRef.current;
    pendingRef.current = null;
    if (target !== null && panelRef.current) panelRef.current.resize(target);
  }, [limits]);

  React.useLayoutEffect(() => {
    if (!enabled) return;
    // Every open starts from the whole content, never a stale saved size.
    chosenRef.current = null;
    const content = contentRef.current;
    const group = content?.closest<HTMLElement>("[data-panel-group]");
    if (!content || !group) return;
    settle();
    const observer = new ResizeObserver(() => settle());
    observer.observe(content);
    observer.observe(group);
    if (footerRef.current) observer.observe(footerRef.current);
    return () => observer.disconnect();
  }, [enabled, settle]);

  const onDragging = React.useCallback((dragging: boolean) => {
    draggingRef.current = dragging;
    if (dragging) return;
    const measured = measure();
    if (measured) choose(measured.currentPx);
  }, [measure, choose]);

  /** Arrow keys step one whole line, Home/End go to the first line or all content. */
  const onKeyDownCapture = React.useCallback((event: Pick<KeyboardEvent, "key" | "preventDefault">) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const measured = measure();
    if (!measured) return;
    // Pre-empt the library's percentage step, which would land between lines.
    event.preventDefault();
    const { bounds, currentPx } = measured;
    const index = bounds.indexOf(contentFitTarget(bounds, currentPx));
    const step = event.key === "Home" ? 0
      : event.key === "End" ? bounds.length - 1
        : Math.max(0, Math.min(bounds.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    choose(bounds[step]);
  }, [measure, choose]);

  /** Double-clicking the sash fits the drawer to its content again. */
  const onDoubleClick = React.useCallback(() => {
    const measured = measure();
    if (measured) choose(measured.bounds[measured.bounds.length - 1]);
  }, [measure, choose]);

  return {
    panelRef,
    contentRef,
    footerRef,
    /** Spread onto the drawer's ResizableHandle. */
    handleProps: { onDragging, onKeyDownCapture, onDoubleClick },
    minSize: enabled && limits ? limits.min : undefined,
    maxSize: enabled && limits ? limits.max : undefined,
    /** The companion results panel's minimum, from the same pixel budget. */
    resultsMinSize: enabled && limits ? limits.results : undefined,
  };
}
