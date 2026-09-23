// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";
import { EMPTY_EVENT_NOTE, eventNoteKey, useEventNotesStore, type EventNoteTarget } from "@/stores/event-notes-store";

export function ChartEventNote({ target, expanded, onEditing }: {
  target: EventNoteTarget;
  expanded: boolean;
  onEditing: (eventId: string, expanded: boolean) => void;
}) {
  const t = useT();
  const key = eventNoteKey(target);
  const note = useEventNotesStore((state) => state.notes[key] ?? EMPTY_EVENT_NOTE);
  const targetRef = React.useRef(target);
  React.useLayoutEffect(() => { targetRef.current = target; }, [target]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    void useEventNotesStore.getState().load(targetRef.current, controller.signal);
    const refresh = () => { void useEventNotesStore.getState().load(targetRef.current, controller.signal, true); };
    window.addEventListener("focus", refresh);
    window.addEventListener("aries://notes-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("aries://notes-changed", refresh);
      controller.abort();
      void useEventNotesStore.getState().flush(key);
      onEditing(targetRef.current.eventId, false);
    };
  }, [key, onEditing]);
  React.useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    const controller = new AbortController();
    void useEventNotesStore.getState().load(targetRef.current, controller.signal, true);
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
      void useEventNotesStore.getState().flush(key);
    };
  }, [expanded, key]);
  const preview = note.text.trimStart().split(/\r?\n/)[0];
  const label = t("chartEvents.noteFor", { name: target.name });
  const close = () => {
    void useEventNotesStore.getState().flush(key);
    onEditing(target.eventId, false);
  };
  return (
    <div data-event-note className="w-[calc(100cqw_-_2_*_max(var(--aries-list-cell-x),var(--aries-list-outer-x)))] whitespace-normal" onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
      {expanded ? (
        <textarea ref={textareaRef} rows={5} wrap="soft" value={note.text} readOnly={!note.loaded}
          data-aries-control-appearance="local"
          aria-label={label} aria-busy={note.loading || note.saving}
          placeholder={t(note.loading ? "notes.loadingNotes" : "editor.notesPlaceholder")}
          className="block w-full max-h-[var(--aries-pane-drawer-list-max-height)] resize-none appearance-none overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-none border-0 bg-transparent p-0 text-inherit shadow-none outline-none field-sizing-fixed placeholder:text-muted-foreground"
          onChange={(event) => useEventNotesStore.getState().edit(target, event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); close(); }
          }} />
      ) : (
        <button type="button" aria-label={label} aria-expanded={false}
          className={`block w-full cursor-text text-left ${preview ? "text-inherit" : "aries-list-secondary-text"}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            // Select before blur collapses the previous row and moves this target.
            event.preventDefault();
            onEditing(target.eventId, true);
          }}
          onClick={() => onEditing(target.eventId, true)}>
          <span className="block truncate">{preview || t(note.loading ? "notes.loadingNotes" : "editor.notesPlaceholder")}{preview && note.text.trimStart().includes("\n") ? "…" : ""}</span>
        </button>
      )}
      {note.error ? <div role="alert" className="text-destructive whitespace-normal [overflow-wrap:anywhere]">
        {t(note.error)}
        <Button type="button" size="xs" variant="ghost" onClick={() => {
          if (note.error === "notes.externalConflict") void useEventNotesStore.getState().load(target, undefined, true, true);
          else if (note.loaded) void useEventNotesStore.getState().flush(key);
          else void useEventNotesStore.getState().load(target);
        }}>{t(note.error === "notes.externalConflict" ? "wheelPreset.retry" : "aspectList.retry")}</Button>
      </div> : null}
    </div>
  );
}
