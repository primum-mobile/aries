// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from "@/components/ui/resizable";
import { Input } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useT } from "@/lib/i18n/i18n";
import { executeWorkspaceContextMenuAction, type WorkspaceOpenResult } from "@/lib/daemon/client";
import { LIST_BUTTON_PROPS, LIST_PANE_CLASSES, LIST_ROW_CLASSES, useListRowHeight } from "@/lib/list-tokens";
import { recordChartPerf, perfNow } from "@/lib/chart/perf";
import { applyImmediateWorkspaceCommandResult } from "@/stores/daemon-workspace-adapter";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { EMPTY_EVENT_VIEW, filteredChartEvents, rankedEventTags, useChartEventsStore, type EventTag, type SavedChartEvent } from "@/stores/chart-events-store";
import { ChartEventNote } from "./chart-event-note";
import { useEventNotesStore } from "@/stores/event-notes-store";
import { EventTagEditor, EventTagPill } from "./chart-event-tags";
import { ListSegmentedControl } from "./list-controls";
import { RetainedPaneShell } from "./retained-pane-shell";
import { buildStableRowKeys, useEdgeExtend } from "./stitched-list-harness";
import { SidebarListTable, SidebarListBody,
  SidebarListRow, SidebarListCell, SidebarListDateCell, SidebarListTimeCell, SidebarListSpacerRow } from "./sidebar-list-table";

export function ChartEventsPanel({ documentId }: { documentId: string }) {
  const t = useT();
  const view = useChartEventsStore((s) => s.views[documentId] ?? EMPTY_EVENT_VIEW);
  const tagDrawerId = React.useId();
  const catalog = React.useMemo(() => rankedEventTags(view.tagCatalog, view.tagCounts), [view.tagCatalog, view.tagCounts]);
  const visibleTags = React.useMemo(() => catalog.filter((tag) => tag.name.toLocaleLowerCase().includes(view.tagQuery.trim().toLocaleLowerCase())), [catalog, view.tagQuery]);
  const close = useWorkspaceStore((s) => s.closeChartEventsPane);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const rowHeight = useListRowHeight("symbolic");
  const [viewportHeight, setViewportHeight] = React.useState(600);
  const [selected, setSelected] = React.useState<SavedChartEvent | null>(null);
  const [renaming, setRenaming] = React.useState<SavedChartEvent | null>(null);
  const [selectedTag, setSelectedTag] = React.useState<EventTag | null>(null);
  const [renamingTag, setRenamingTag] = React.useState<EventTag | null>(null);
  const [editingNote, setEditingNote] = React.useState<string | null>(null);
  const onNoteEditing = React.useCallback((id: string, expanded: boolean) => {
    setEditingNote((current) => expanded ? id : current === id ? null : current);
  }, []);
  React.useEffect(() => {
    const flush = (event: Event) => {
      const promise = useEventNotesStore.getState().flushAll();
      (event as CustomEvent<{ awaitFlush?: Promise<unknown>[] }>).detail?.awaitFlush?.push(promise);
    };
    window.addEventListener("aries://flush-notes", flush);
    return () => { window.removeEventListener("aries://flush-notes", flush); void useEventNotesStore.getState().flushAll(); };
  }, []);
  const [editingEvent, setEditingEvent] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const openedAt = React.useRef(perfNow());
  const recordedPaint = React.useRef(false);

  React.useEffect(() => {
    void useChartEventsStore.getState().load(documentId);
  }, [documentId, view.revision]);

  const { rows, query, untagged, tagIds, tagMatch } = view;
  const filtered = React.useMemo(() => {
    const matches = new Set(filteredChartEvents({ rows, query, untagged, tagIds, tagMatch }).map((row) => row.id));
    return rows.filter((row) => matches.has(row.id) || row.id === editingEvent || row.id === editingNote);
  }, [rows, query, untagged, tagIds, tagMatch, editingEvent, editingNote]);
  const filtering = Boolean(view.query.trim() || view.tagIds.length || view.untagged);
  React.useEffect(() => {
    if (filtering && view.loaded && !view.loading && !view.stale && !view.error && view.rows.length < view.total) {
      void useChartEventsStore.getState().load(documentId, true);
    }
  }, [documentId, filtering, view.loaded, view.loading, view.stale, view.error, view.rows.length, view.total]);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = useChartEventsStore.getState().views[documentId]?.scrollTop ?? 0;
    let frame = 0;
    const read = () => {
      frame = 0;
      setViewportHeight(scroller.clientHeight);
      const cache = useChartEventsStore.getState();
      const width = scroller.clientWidth;
      cache.patch(documentId, { scrollTop: scroller.scrollTop, rowWidth: width,
        ...(cache.views[documentId]?.rowWidth !== width ? { rowHeights: {} } : {}) });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [documentId]);

  React.useEffect(() => {
    if (!view.loaded || recordedPaint.current) return;
    const frame = requestAnimationFrame(() => {
      recordedPaint.current = true;
      recordChartPerf("chart-events-useful-paint", {
        rowCount: view.rows.length, totalRows: view.total, openToPaintMs: perfNow() - openedAt.current,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [view.loaded, view.rows.length, view.total]);

  const extend = React.useCallback(() => {
    void useChartEventsStore.getState().load(documentId, true);
  }, [documentId]);
  useEdgeExtend({ scrollerRef, rowCount: filtered.length, thresholdPx: rowHeight * 16,
    canExtendBackward: false, canExtendForward: !view.loading && !view.stale && !view.error && view.rows.length < view.total,
    onExtend: extend, recheckToken: view.loading });

  const openEvent = async (row: SavedChartEvent) => {
    if (pending) return;
    setPending(true);
    try {
      const result = await executeWorkspaceContextMenuAction("workspace.open_event", { documentId, eventId: row.id });
      applyImmediateWorkspaceCommandResult(result as unknown as WorkspaceOpenResult, documentId);
      useChartEventsStore.getState().patch(documentId, { error: null });
    } catch (error) {
      console.error("[chart-events-open]", error);
      useChartEventsStore.getState().patch(documentId, { error: "chartEvents.openError" });
    } finally { setPending(false); }
  };

  const changeEvent = async (row: SavedChartEvent, remove: boolean) => {
    if (pending) return;
    setPending(true);
    try {
      await executeWorkspaceContextMenuAction(remove ? "workspace.remove_event" : "workspace.rename_event", {
        documentId, eventId: row.id, name,
      });
      setRenaming(null);
      useChartEventsStore.getState().patch(documentId, { error: null });
      useChartEventsStore.getState().invalidate([documentId]);
    } catch (error) {
      console.error("[chart-events-change]", error);
      useChartEventsStore.getState().patch(documentId, { error: "chartEvents.changeError" });
    } finally { setPending(false); }
  };

  const changeTag = async (remove: boolean) => {
    const tag = remove ? selectedTag : renamingTag;
    if (!tag || pending) return;
    setPending(true);
    try {
      await useChartEventsStore.getState().changeTag(documentId, tag.id, remove ? undefined : name);
      setRenamingTag(null);
      useChartEventsStore.getState().patch(documentId, { error: null });
    } catch {
      useChartEventsStore.getState().patch(documentId, { error: "chartEvents.tagError" });
    } finally { setPending(false); }
  };
  const virtual = useEventRowWindow(documentId, filtered, scrollerRef, view.scrollTop, viewportHeight, rowHeight, view.rowHeights);
  const visibleRows = filtered.slice(virtual.start, virtual.end);
  const keys = buildStableRowKeys(visibleRows, (row) => row.id);
  const setTagContext = (tag: EventTag) => { setSelectedTag(tag); setSelected(null); };
  const filters = (patch: Partial<typeof view>) => useChartEventsStore.getState().patch(documentId, patch);

  return (
    <ContextMenu onOpenChange={(open) => { if (!open) { setSelected(null); setSelectedTag(null); } }}>
    <ContextMenuTrigger render={<div className="h-full min-h-0" />}>
    <RetainedPaneShell title={t("chartEvents.title")} sourceName={view.sourceName}
      closeLabel={t("chartEvents.close")} onClose={close} closeAppearance="list" headerDensity="compact">
      <div className={LIST_PANE_CLASSES.compactHeader}>
        <Input value={view.query} placeholder={t("chartEvents.search")} aria-label={t("chartEvents.search")}
          onChange={(event) => {
            const cache = useChartEventsStore.getState();
            cache.patch(documentId, { query: event.target.value });
          }} />
        <div className={LIST_PANE_CLASSES.controlRow}>
          <Button type="button" {...LIST_BUTTON_PROPS.command}
            variant={view.tagIds.length || view.untagged ? "default" : LIST_BUTTON_PROPS.command.variant}
            aria-expanded={view.tagsOpen} aria-controls={tagDrawerId}
            aria-pressed={view.tagIds.length > 0 || view.untagged}
            onClick={() => filters({ tagsOpen: !view.tagsOpen })}>{t("chartEvents.tags")}</Button>
        </div>
        {renaming || renamingTag ? (
          <form className={LIST_PANE_CLASSES.controlRow} onSubmit={(event) => {
            event.preventDefault();
            if (renamingTag) void changeTag(false);
            else if (renaming) void changeEvent(renaming, false);
          }}>
            <Input autoFocus value={name} aria-label={t(renamingTag ? "chartEvents.tags" : "chartEvents.name")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { setRenaming(null); setRenamingTag(null); } }} />
            <Button {...LIST_BUTTON_PROPS.command} type="submit" disabled={pending || !name.trim()}>{t("chartEvents.rename")}</Button>
            <Button {...LIST_BUTTON_PROPS.command} type="button" onClick={() => { setRenaming(null); setRenamingTag(null); }}>{t("chartEvents.cancel")}</Button>
          </form>
        ) : null}
      </div>
      {view.error ? <div role="alert" className={LIST_PANE_CLASSES.error}>{t(view.error)}</div> : null}
      <ResizablePanelGroup direction="vertical" autoSaveId="aries.chart-events-tags-vs-results" className="min-h-0 min-w-0">
        {view.tagsOpen ? <>
          <ResizablePanel id="event-tags" order={1} defaultSize={40} minSize={20} className="min-h-0 min-w-0">
            <div id={tagDrawerId} role="group" aria-label={t("chartEvents.tags")}
              className="h-full min-h-0 overflow-auto px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-padding-y)]">
              <Input value={view.tagQuery} placeholder={t("chartEvents.findTag")} aria-label={t("chartEvents.findTag")}
                onChange={(event) => filters({ tagQuery: event.target.value })} />
              <div className="mt-[var(--aries-control-gap)] flex flex-wrap gap-[var(--aries-control-gap)]" aria-label={t("chartEvents.tags")}>
                <EventTagPill active={!view.tagIds.length && !view.untagged}
                  onClick={() => filters({ tagIds: [], untagged: false })}>{t("chartEvents.all")}</EventTagPill>
                {visibleTags.map((tag) => (
                  <EventTagPill key={tag.id} data-event-tag={tag.id} active={view.tagIds.includes(tag.id)}
                    onContextMenu={() => setTagContext(tag)}
                    onClick={() => filters({ untagged: false, tagIds: view.tagIds.includes(tag.id)
                      ? view.tagIds.filter((id) => id !== tag.id) : [...view.tagIds, tag.id] })}>{tag.name}</EventTagPill>
                ))}
                <EventTagPill active={view.untagged} onClick={() => filters({ untagged: !view.untagged, tagIds: [] })}>
                  {t("chartEvents.untagged")}
                </EventTagPill>
                {view.tagIds.length > 1 ? <ListSegmentedControl label={t("chartEvents.match")}
                  options={[{ value: "any", label: t("chartEvents.any") }, { value: "all", label: t("chartEvents.all") }]}
                  value={view.tagMatch} onChange={(tagMatch) => filters({ tagMatch })} /> : null}
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle aria-label={t("chartEvents.tags")} />
        </> : null}
        <ResizablePanel id="event-results" order={2} minSize={20} className="flex min-h-0 min-w-0 flex-col">
          <div ref={scrollerRef} className={`${LIST_PANE_CLASSES.scroller} [container-type:inline-size]`}>
              <SidebarListTable profile="directions-titled" aria-busy={view.loading || pending}>
                <SidebarListBody data-rendered-row-count={visibleRows.length} data-total-row-count={filtered.length}>
                  {virtual.before > 0 ? <SidebarListSpacerRow colSpan={3} height={virtual.before} /> : null}
                  {visibleRows.map((row, index) => (
                    <React.Fragment key={keys[index]}>
                    <SidebarListRow data-event-row={row.id} className={`${LIST_ROW_CLASSES.hover} border-b-0`}
                      onClick={() => void openEvent(row)} onContextMenu={(event) => {
                        if ((event.target as HTMLElement).closest("[data-event-tag]")) return;
                        setSelectedTag(null); setSelected(row);
                      }}>
                      <SidebarListCell className="whitespace-normal">
                        <button type="button" className="whitespace-normal text-left [overflow-wrap:anywhere]" disabled={pending} onClick={(event) => {
                          event.stopPropagation(); void openEvent(row);
                        }}>{row.name}</button>
                        <div><EventTagEditor documentId={documentId} event={row} catalog={catalog}
                          onTagContext={setTagContext} onEditing={setEditingEvent} /></div>
                      </SidebarListCell>
                      <SidebarListDateCell title={row.datetime}>{row.date}</SidebarListDateCell>
                      <SidebarListTimeCell title={row.datetime}>{row.time}</SidebarListTimeCell>
                    </SidebarListRow>
                    <SidebarListRow data-event-row={row.id} className="[--aries-list-hover-bg:transparent]">
                      <SidebarListCell colSpan={3} className="whitespace-normal">
                        <ChartEventNote target={{ recordId: view.recordId, eventId: row.id, name: row.name }}
                          expanded={editingNote === row.id} onEditing={onNoteEditing} />
                      </SidebarListCell>
                    </SidebarListRow>
                    </React.Fragment>
                  ))}
                  {virtual.after > 0 ? <SidebarListSpacerRow colSpan={3} height={virtual.after} /> : null}
                  {filtered.length === 0 ? <SidebarListRow><SidebarListCell colSpan={3}>
                    {(view.loading || view.rows.length < view.total) ? t("chartEvents.loading") : filtering ? t("chartEvents.noMatches") : t("chartEvents.empty")}
                  </SidebarListCell></SidebarListRow> : null}
                </SidebarListBody>
              </SidebarListTable>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </RetainedPaneShell>
    </ContextMenuTrigger>
        <ContextMenuContent>
          {selectedTag ? <>
            <ContextMenuItem disabled={pending} onClick={() => {
              setRenaming(null); setRenamingTag(selectedTag); setName(selectedTag.name);
            }}>{t("chartEvents.rename")}</ContextMenuItem>
            <ContextMenuItem disabled={pending} onClick={() => void changeTag(true)}>{t("chartEvents.deleteTag")}</ContextMenuItem>
          </> : <>
          <ContextMenuItem disabled={!selected || pending} onClick={() => { if (selected) void openEvent(selected); }}>{t("chartEvents.open")}</ContextMenuItem>
          <ContextMenuItem disabled={!selected || pending} onClick={() => { if (selected) onNoteEditing(selected.id, true); }}>{t("notes.title")}</ContextMenuItem>
          <ContextMenuItem disabled={!selected || pending} onClick={() => {
            if (selected) { setRenamingTag(null); setRenaming(selected); setName(selected.name); }
          }}>{t("chartEvents.rename")}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!selected || pending} onClick={() => { if (selected) void changeEvent(selected, true); }}>{t("chartEvents.remove")}</ContextMenuItem>
          </>}
        </ContextMenuContent>
      </ContextMenu>
  );
}

/** Tag pills wrap naturally. Measure rendered native rows instead of clipping
 * tags or pretending every event still occupies one fixed-height line. */
function useEventRowWindow(documentId: string, rows: SavedChartEvent[], scroller: React.RefObject<HTMLDivElement | null>,
  scrollTop: number, viewport: number, estimate: number, heights: Record<string, number>) {
  const offsets = React.useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result[result.length - 1] + (heights[row.id] ?? estimate * 3));
    return result;
  }, [rows, estimate, heights]);
  let first = 0;
  while (first < rows.length && offsets[first + 1] < scrollTop) first++;
  const start = Math.max(0, first - 16);
  let end = first;
  while (end < rows.length && offsets[end] < scrollTop + viewport) end++;
  end = Math.min(rows.length, end + 16);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const elements = Array.from(el.querySelectorAll<HTMLElement>("[data-event-row]"));
    const measure = () => {
      let modified = false;
      const next = { ...heights };
      const measured: Record<string, number> = {};
      for (const element of elements) {
        const id = element.dataset.eventRow!;
        const height = element.getBoundingClientRect().height;
        measured[id] = (measured[id] ?? 0) + height;
      }
      for (const [id, height] of Object.entries(measured)) {
        if (height > 0 && heights[id] !== height) { next[id] = height; modified = true; }
      }
      if (!modified) return;
      const before = rows.slice(0, first).reduce((sum, row) => sum + (next[row.id] ?? estimate * 3), 0);
      el.scrollTop += before - offsets[first];
      useChartEventsStore.getState().patch(documentId, { rowHeights: next, scrollTop: el.scrollTop });
    };
    const observer = new ResizeObserver(measure);
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [documentId, scroller, rows, first, start, end, offsets, estimate, heights]);
  return { start, end, before: offsets[start], after: offsets[rows.length] - offsets[end] };
}
