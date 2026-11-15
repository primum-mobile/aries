// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Dev-only in-app copy editor. ⌘⇧L (Ctrl+Shift+L elsewhere) toggles copy mode:
// hover outlines catalog text, a click opens its English value, Enter saves it
// to src/locales/en.json through the local helper (scripts/copy-editor/server.mjs),
// which also queues the affected translations in scripts/i18n/copy_backlog.json.
// The search field finds text that cannot be clicked (canvas labels, hidden
// tooltips). Internal tooling: never shipped, so its own text is not localized.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { BUNDLES } from "../messages";
import { installCanvasTextRecorder, setCanvasTextRecording } from "./canvas-text";
import { COPY_EDITOR_REPAINT_EVENT, copyOverride, setCopyMode, setCopyOverride, useCopyMode } from "./copy-store";
import { exactHitAt, hitAt, type CopyHit } from "./resolve";

installCanvasTextRecorder();

// Must match COPY_EDITOR_PORT in scripts/copy-editor/server.mjs.
const COPY_EDITOR_PORT = 8790;
const SAVE_URL = `http://127.0.0.1:${COPY_EDITOR_PORT}/copy/save`;
const PANEL_WIDTH = 440;
const SEARCH_LIMIT = 40;
const BLOCKED_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "contextmenu"];
const LAYER_Z = 2147483000;

// keys is empty for painted text that does not come from en.json (read-only).
type Editing = { keys: string[]; key: string; anchor: DOMRect | null; text?: string };
type Highlight = { rect: DOMRect; editable: boolean };
type Status = { tone: "info" | "error"; text: string } | null;
type LastSave = { key: string; from: string; to: string };

function englishFor(key: string): string {
  return copyOverride(key) ?? BUNDLES.en?.[key] ?? "";
}

function placeholders(value: string): string {
  return [...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((m) => m[0]).sort().join(" ");
}

async function postEdit(key: string, from: string, to: string): Promise<{ queued: string[] }> {
  let response: Response;
  try {
    response = await fetch(SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, from, to }),
    });
  } catch {
    throw new Error(`Save helper unreachable on 127.0.0.1:${COPY_EDITOR_PORT} — is \`next dev\` running?`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `save failed (${response.status})`);
  return { queued: body.queued ?? [] };
}

function panelPosition(anchor: DOMRect | null): React.CSSProperties {
  const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
  if (!anchor) return { width, left: (window.innerWidth - width) / 2, bottom: 64 };
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const below = window.innerHeight - anchor.bottom;
  return below > 260
    ? { width, left, top: anchor.bottom + 8 }
    : { width, left, bottom: Math.max(8, window.innerHeight - anchor.top + 8) };
}

export default function CopyEditor() {
  const active = useCopyMode();
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [lastSave, setLastSave] = useState<LastSave | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const open = useCallback((keys: string[], anchor: DOMRect | null, key = keys[0]) => {
    setEditing({ keys, key, anchor });
    setDraft(englishFor(key));
    setStatus(null);
    requestAnimationFrame(() => textareaRef.current?.select());
  }, []);

  const openHit = useCallback((hit: CopyHit) => {
    if (hit.keys.length) open(hit.keys, hit.rect);
    else setEditing({ keys: [], key: "", anchor: hit.rect, text: hit.text });
  }, [open]);

  // Canvas text is recorded only while copy mode is on.
  useEffect(() => {
    setCanvasTextRecording(active);
  }, [active]);

  // ⌘⇧L toggles copy mode; Esc closes the editor, then leaves copy mode.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.repeat && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey) && event.code === "KeyL") {
        event.preventDefault();
        event.stopPropagation();
        setCopyMode(!active);
        setEditing(null);
        setHighlight(null);
        return;
      }
      if (event.key !== "Escape" || !active) return;
      event.preventDefault();
      event.stopPropagation();
      if (editing) setEditing(null);
      else setCopyMode(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, editing]);

  // While active, pointer input targets copy instead of the app.
  useEffect(() => {
    if (!active) return;
    const inside = (event: Event) => event.target instanceof Node && !!layerRef.current?.contains(event.target);
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (inside(event) || !(event.target instanceof Element)) return;
      const target = event.target;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const hit = exactHitAt(event.clientX, event.clientY, target);
        setHighlight(hit ? { rect: hit.rect, editable: hit.keys.length > 0 } : null);
      });
    };
    const onBlocked = (event: Event) => {
      if (inside(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "click" || !(event instanceof MouseEvent) || !(event.target instanceof Element)) return;
      const hit = hitAt(event.clientX, event.clientY, event.target);
      if (hit) openHit(hit);
      else setStatus({ tone: "error", text: "No catalog string here — try search." });
    };
    window.addEventListener("pointermove", onMove, true);
    BLOCKED_EVENTS.forEach((type) => window.addEventListener(type, onBlocked, true));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove, true);
      BLOCKED_EVENTS.forEach((type) => window.removeEventListener(type, onBlocked, true));
    };
  }, [active, openHit]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const out: [string, string][] = [];
    for (const key of Object.keys(BUNDLES.en ?? {})) {
      const value = englishFor(key);
      if (value.toLowerCase().includes(needle) || key.toLowerCase().includes(needle)) out.push([key, value]);
      if (out.length >= SEARCH_LIMIT) break;
    }
    return out;
  }, [query]);

  const save = useCallback(
    async (key: string, from: string, to: string, undo = false) => {
      setSaving(true);
      try {
        const { queued } = await postEdit(key, from, to);
        setCopyOverride(key, to);
        // Canvas views paint text outside React: repaint them with the new wording.
        requestAnimationFrame(() => window.dispatchEvent(new Event(COPY_EDITOR_REPAINT_EVENT)));
        setLastSave(undo ? null : { key, from, to });
        if (!undo && editing?.key === key) setEditing(null);
        const pending = queued.length ? ` · ${queued.join(", ")} queued for translation` : "";
        setStatus({ tone: "info", text: `${undo ? "Reverted" : "Saved"} ${key}${pending}` });
      } catch (error) {
        setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        setSaving(false);
      }
    },
    [editing],
  );

  if (!active) return null;
  const current = editing ? englishFor(editing.key) : "";
  const placeholderProblem =
    editing && placeholders(draft) !== placeholders(current)
      ? `Keep the placeholders ${placeholders(current) || "(none)"} — they are filled in by code.`
      : null;
  const canSave = !!editing && !saving && !placeholderProblem && draft.trim() !== "" && draft !== current;

  return createPortal(
    <div ref={layerRef} data-copy-editor="" className="text-[length:var(--aries-font-size-reading)]">
      {highlight ? (
        <div
          aria-hidden
          className={
            highlight.editable
              ? "pointer-events-none fixed rounded-sm ring-2 ring-ring"
              : "pointer-events-none fixed rounded-sm border border-dashed border-muted-foreground"
          }
          style={{
            zIndex: LAYER_Z,
            left: highlight.rect.left - 2,
            top: highlight.rect.top - 2,
            width: highlight.rect.width + 4,
            height: highlight.rect.height + 4,
          }}
        />
      ) : null}

      {editing && !editing.keys.length ? (
        <div
          className="fixed flex flex-col gap-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          style={{ zIndex: LAYER_Z + 1, ...panelPosition(editing.anchor) }}
        >
          <p className="break-words font-medium">{editing.text}</p>
          <p className="text-xs text-muted-foreground">
            Not in en.json: this is a value, a glyph, or text the daemon serves (mtexts). It cannot be edited here.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="xs" variant="ghost" onClick={() => void navigator.clipboard?.writeText(editing.text ?? "")}>
              Copy text
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}

      {editing && editing.keys.length ? (
        <div
          className="fixed flex flex-col gap-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          style={{ zIndex: LAYER_Z + 1, ...panelPosition(editing.anchor) }}
        >
          {editing.keys.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {editing.keys.map((key) => (
                <Button key={key} size="xs" variant={key === editing.key ? "secondary" : "ghost"} onClick={() => open(editing.keys, editing.anchor, key)}>
                  {key}
                </Button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="self-start font-mono text-xs text-muted-foreground hover:text-foreground"
            title="Copy key"
            onClick={() => void navigator.clipboard?.writeText(editing.key)}
          >
            {editing.key}
          </button>
          <Textarea
            ref={textareaRef}
            autoFocus
            rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 48)))}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSave) void save(editing.key, current, draft);
              }
            }}
          />
          {placeholderProblem ? <p className="text-xs text-destructive">{placeholderProblem}</p> : null}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Enter saves · Shift+Enter new line · Esc closes</span>
            <Button size="xs" disabled={!canSave} onClick={() => void save(editing.key, current, draft)}>
              Save
            </Button>
          </div>
        </div>
      ) : null}

      <div
        className="fixed bottom-3 left-1/2 flex -translate-x-1/2 flex-col gap-1 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg"
        style={{ zIndex: LAYER_Z + 2, width: Math.min(PANEL_WIDTH, window.innerWidth - 16) }}
      >
        {results.length ? (
          <ul className="max-h-64 overflow-y-auto">
            {results.map(([key, value]) => (
              <li key={key}>
                <button
                  type="button"
                  className="flex w-full flex-col rounded-sm px-2 py-1 text-left hover:bg-muted"
                  onClick={() => {
                    setQuery("");
                    open([key], null);
                  }}
                >
                  <span className="truncate">{value}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{key}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-medium">Copy mode</span>
          <Input
            value={query}
            placeholder="Search English copy or keys"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) {
                setQuery("");
                open([results[0][0]], null);
              }
            }}
          />
          {lastSave ? (
            <Button size="xs" variant="ghost" disabled={saving} onClick={() => void save(lastSave.key, lastSave.to, lastSave.from, true)}>
              Undo
            </Button>
          ) : null}
        </div>
        <p className={status?.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {status?.text ?? "Click any text to edit it · ⌘⇧L or Esc to leave"}
        </p>
      </div>
    </div>,
    document.body,
  );
}
