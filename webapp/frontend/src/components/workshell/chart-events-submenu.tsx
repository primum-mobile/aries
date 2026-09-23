// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { CalendarRange } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent,
  ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { useT } from "@/lib/i18n/i18n";
import { EMPTY_EVENT_VIEW, useChartEventsStore } from "@/stores/chart-events-store";
import { useEdgeExtend } from "./stitched-list-harness";

/** A tab-owned, paged flyout. Only event summaries are loaded on hover. */
export function ChartEventsSubmenu({ documentId, count, onAction }: {
  documentId: string;
  count: number;
  onAction: (actionId: string, payload: Record<string, unknown>) => void;
}) {
  const t = useT();
  const cacheId = `${documentId}:events-menu`;
  const view = useChartEventsStore((s) => s.views[cacheId] ?? EMPTY_EVENT_VIEW);
  const [open, setOpen] = React.useState(false);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const pendingFocus = React.useRef<number | null>(null);
  const [viewport, setViewport] = React.useState({ top: 0, height: 600, rowHeight: 32 });
  const start = Math.max(0, Math.min(view.rows.length - 1, Math.floor(viewport.top / viewport.rowHeight)) - 8);
  const end = Math.min(view.rows.length, start + Math.ceil(viewport.height / viewport.rowHeight) + 16);

  React.useEffect(() => {
    if (open) void useChartEventsStore.getState().load(cacheId, false, documentId);
  }, [open, cacheId, documentId, view.revision]);

  const readViewport = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const row = el.querySelector<HTMLElement>("[data-event-index]");
    const measured = row?.getBoundingClientRect().height;
    setViewport((previous) => ({ top: el.scrollTop, height: el.clientHeight,
      rowHeight: measured || previous.rowHeight }));
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    readViewport();
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(readViewport);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, view.rows.length, readViewport]);

  React.useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const row = scrollerRef.current?.querySelector<HTMLElement>(`[data-event-index="${pendingFocus.current}"]`);
    if (row) { row.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [start, end, viewport.top]);

  const extend = React.useCallback(() => {
    void useChartEventsStore.getState().load(cacheId, true, documentId);
  }, [cacheId, documentId]);
  useEdgeExtend({ scrollerRef, rowCount: view.rows.length, thresholdPx: viewport.rowHeight * 16,
    canExtendBackward: false,
    canExtendForward: open && !view.loading && !view.stale && view.rows.length < view.total,
    onExtend: extend, recheckToken: `${open}:${view.loading}` });

  return (
    <ContextMenuSub onOpenChange={setOpen}>
      <ContextMenuSubTrigger><CalendarRange />{t("chartEvents.title")} ({view.loaded && !view.stale ? view.total : count})</ContextMenuSubTrigger>
      <ContextMenuSubContent ref={scrollerRef} onScroll={readViewport} onKeyDownCapture={(event) => {
        // Preserve arrow navigation across the virtual window; ordinary menu
        // focus/typeahead remains owned by Base UI within the mounted rows.
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-event-index]");
        if (!target || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const current = Number(target.dataset.eventIndex);
        const next = event.key === "Home" ? 0 : event.key === "End" ? view.rows.length - 1
          : current + (event.key === "ArrowDown" ? 1 : -1);
        if (next < 0 || next >= view.rows.length || (next >= start && next < end)) return;
        event.preventDefault(); event.stopPropagation();
        pendingFocus.current = next;
        if (scrollerRef.current) scrollerRef.current.scrollTop = next * viewport.rowHeight;
        readViewport();
      }}>
        {start > 0 ? <div role="presentation" style={{ height: start * viewport.rowHeight }} /> : null}
        {view.rows.slice(start, end).map((row, index) => (
          <ContextMenuItem key={row.id} data-event-index={start + index} label={row.name}
            title={row.datetime} onClick={() => onAction("workspace.open_event", { documentId, eventId: row.id })}>
            <span className="whitespace-nowrap">{row.name}</span>
            <span className="ml-auto whitespace-nowrap text-muted-foreground">{row.date} {row.time}</span>
          </ContextMenuItem>
        ))}
        {end < view.rows.length ? <div role="presentation" style={{ height: (view.rows.length - end) * viewport.rowHeight }} /> : null}
        {view.error ? <ContextMenuItem disabled>{t(view.error)}</ContextMenuItem> : null}
        {!view.rows.length ? <ContextMenuItem disabled>{t(view.loading ? "chartEvents.loading" : "chartEvents.none")}</ContextMenuItem> : null}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onAction("workspace.show_events", { documentId })}>{t("chartEvents.manage")}</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
