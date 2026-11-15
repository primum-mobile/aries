// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

type FocusDocument = Pick<Document, "activeElement" | "body" | "documentElement">;

/** Activation may focus a chart surface, but must leave an ongoing surface,
 * editor or modal interaction in place. The caller checks again before a
 * deferred focus so newly opened editors and dialogs retain their focus. */
export function shouldRestoreWorkspaceKeyboardFocus(
  target: HTMLElement,
  page: FocusDocument | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  if (!page || !target.isConnected) return false;
  const active = page.activeElement;
  if (!active || active === page.body || active === page.documentElement) return true;
  if (!active.isConnected) return true;
  if (target.contains(active)) return false;
  if (active.closest('[role="dialog"], [role="alertdialog"]')) return false;
  return !(
    active.tagName === "INPUT"
    || active.tagName === "TEXTAREA"
    || active.tagName === "SELECT"
    || (active as HTMLElement).isContentEditable
  );
}

/** Escape belongs to the shell even when the editor frame owns the keyboard. */
export function bindNotesEscape(editorWindow: EventTarget, returnFocusToChart: () => void): () => void {
  const onKeyDown = (input: Event) => {
    const event = input as KeyboardEvent;
    if (event.key !== "Escape" && event.code !== "Escape") return;
    if (event.repeat || event.isComposing || event.keyCode === 229) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    returnFocusToChart();
  };
  const capture = { capture: true };
  editorWindow.addEventListener("keydown", onKeyDown, capture);
  return () => editorWindow.removeEventListener("keydown", onKeyDown, capture);
}
