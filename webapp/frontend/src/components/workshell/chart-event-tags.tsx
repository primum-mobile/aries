// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Popover } from "@base-ui/react/popover";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";
import { useChartEventsStore, type EventTag, type SavedChartEvent } from "@/stores/chart-events-store";

const pillClass = "h-auto min-h-[var(--aries-control-height-compact)] whitespace-normal px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)] [overflow-wrap:anywhere]";

export function EventTagPill({ active = false, ...props }: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return <Button type="button" size="xs" variant={active ? "default" : "outline"}
    className={pillClass} aria-pressed={active} {...props} />;
}

export function EventTagEditor({ documentId, event, catalog, onTagContext, onEditing }: {
  documentId: string;
  event: SavedChartEvent;
  catalog: EventTag[];
  onTagContext: (tag: EventTag) => void;
  onEditing: (id: string | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [query, setQuery] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(false);
  const tags = event.tags ?? [];
  const clean = query.trim().replace(/\s+/g, " ");
  const matching = catalog.filter((tag) => tag.name.toLocaleLowerCase().includes(clean.toLocaleLowerCase()));
  const existing = catalog.find((tag) => tag.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
  const write = async (ids: string[], name?: string) => {
    if (pending) return;
    setPending(true); setError(false);
    try {
      await useChartEventsStore.getState().setTags(documentId, event.id, ids, name);
      if (name !== undefined) setQuery("");
    } catch { setError(true); }
    finally { setPending(false); }
  };
  const toggle = (tag: EventTag) => {
    const ids = tags.map((item) => item.id);
    void write(ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id]);
  };
  return (
    <Popover.Root open={open} onOpenChange={(value) => {
      setOpen(value); onEditing(value ? event.id : null);
      if (!value) { setQuery(""); setError(false); }
    }}>
      <Popover.Trigger ref={setAnchor} render={<Button type="button" size="xs" variant="ghost"
        className="h-auto max-w-full flex-wrap justify-start px-0 whitespace-normal"
        aria-label={t("chartEvents.tags")} />} onClick={(e) => e.stopPropagation()}>
        {tags.map((tag) => <span key={tag.id} data-event-tag={tag.id}
          onContextMenu={() => onTagContext(tag)}
          className="rounded-[var(--aries-radius-ui-control-compact)] border border-border px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)] [overflow-wrap:anywhere]">{tag.name}</span>)}
        <Plus />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4}
          collisionBoundary={anchor?.closest('[data-right-pane-module]') ?? undefined} className="z-[120]">
          <Popover.Popup data-aries-surface="popover" aria-label={t("chartEvents.tags")}
            className="w-64 max-w-[var(--available-width)] rounded-[var(--aries-radius-popover)] border border-border bg-[var(--aries-popover-background)] text-[color:var(--aries-popover-text)] shadow-sm outline-none"
            style={{ padding: "var(--aries-control-padding-x)" }}
            onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            {open ? <>
              <form className="flex items-center border-b border-border"
                style={{ paddingBottom: "var(--aries-control-padding-x)" }} onSubmit={(e) => {
                e.preventDefault();
                if (!clean || pending) return;
                if (existing) { if (!tags.some((tag) => tag.id === existing.id)) toggle(existing); }
                else void write(tags.map((tag) => tag.id), clean);
              }}>
                <input autoFocus maxLength={64} value={query} aria-label={t("chartEvents.findTag")}
                  data-aries-control-appearance="local"
                  className="w-full min-w-0 border-0 bg-transparent p-0 text-inherit shadow-none outline-none placeholder:text-muted-foreground"
                  placeholder={t("chartEvents.findTag")} onChange={(e) => setQuery(e.target.value)} />
                {clean && !existing ? <Button type="submit" size="xs" variant="ghost" disabled={pending} aria-label={t("chartEvents.createTag")}>
                  <Plus />
                </Button> : null}
              </form>
              <div className="flex max-h-[var(--aries-pane-drawer-list-max-height)] flex-wrap gap-[var(--aries-control-gap)] overflow-y-auto"
                style={{ paddingTop: "var(--aries-control-padding-x)" }}>
                {matching.map((tag) => <EventTagPill key={tag.id} disabled={pending} variant="outline"
                  active={tags.some((item) => item.id === tag.id)} onClick={() => toggle(tag)}>
                  {tags.some((item) => item.id === tag.id) ? <Check /> : null}{tag.name}
                </EventTagPill>)}
              </div>
              {error ? <div role="alert">{t("chartEvents.tagError")}</div> : null}
            </> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
