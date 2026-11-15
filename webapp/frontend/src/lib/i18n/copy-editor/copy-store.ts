// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Dev-only state shared by the i18n provider and the in-app copy editor. Kept in
// its own module so a hot reload of en.json or i18n.tsx does not reset it.
//
// - `rendered`: every string t() produced → the keys that produced it, so a
//   click on visible text resolves to its catalog key (params included).
// - `overrides`: English values saved this session, applied by t() at once,
//   before the dev server's hot reload of en.json lands.

import { useSyncExternalStore } from "react";

export const COPY_EDITOR_ENABLED = process.env.NODE_ENV === "development";

const rendered = new Map<string, Set<string>>();
const overrides = new Map<string, string>();
const listeners = new Set<() => void>();
let revision = 0;
// Interpolated values (dates, counts) mint new strings while stepping; forget
// them all now and then — whatever is on screen is recorded again on render.
const RENDERED_LIMIT = 50_000;

export function recordRendered(text: string, key: string): void {
  const value = text.trim();
  if (!value || value === key) return;
  if (rendered.size >= RENDERED_LIMIT && !rendered.has(value)) rendered.clear();
  let keys = rendered.get(value);
  if (!keys) rendered.set(value, (keys = new Set()));
  keys.add(key);
}

export function renderedKeys(text: string): string[] {
  return [...(rendered.get(text.trim()) ?? [])];
}

export function renderedEntries(): IterableIterator<[string, Set<string>]> {
  return rendered.entries();
}

export function copyOverride(key: string): string | undefined {
  return overrides.get(key);
}

export function setCopyOverride(key: string, value: string): void {
  overrides.set(key, value);
  revision += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever an override is saved, so t() consumers re-render. */
export function useCopyOverrideRevision(): number {
  return useSyncExternalStore(subscribe, () => revision, () => 0);
}

// Copy mode survives the hot reload (or full reload) that saving en.json
// triggers, so a run of edits never has to re-enter it.
const MODE_KEY = "ariesCopyEditorMode";
const modeListeners = new Set<() => void>();
let mode: boolean | null = null;

function readMode(): boolean {
  if (mode === null) {
    try {
      mode = window.sessionStorage.getItem(MODE_KEY) === "1";
    } catch {
      mode = false;
    }
  }
  return mode;
}

export function setCopyMode(on: boolean): void {
  mode = on;
  try {
    if (on) window.sessionStorage.setItem(MODE_KEY, "1");
    else window.sessionStorage.removeItem(MODE_KEY);
  } catch {
    // Storage unavailable: the mode just lasts for this page load.
  }
  modeListeners.forEach((listener) => listener());
}

function subscribeMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

export function useCopyMode(): boolean {
  return useSyncExternalStore(subscribeMode, readMode, () => false);
}

// Copy mode asks canvas views to repaint every layer once, so text already on
// screen passes through the canvas text recorder (canvas-text.ts).
export const COPY_EDITOR_REPAINT_EVENT = "aries:copy-editor-repaint";

/** Dev-only subscription for canvas views; a no-op in shipped builds. */
export function onCopyEditorRepaint(repaint: () => void): () => void {
  if (!COPY_EDITOR_ENABLED) return () => undefined;
  window.addEventListener(COPY_EDITOR_REPAINT_EVENT, repaint);
  return () => window.removeEventListener(COPY_EDITOR_REPAINT_EVENT, repaint);
}
