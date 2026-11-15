// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import { bindNotesEscape, shouldRestoreWorkspaceKeyboardFocus } from "../src/components/workshell/workspace-keyboard-focus";

class FocusNode {
  isConnected = true;
  isContentEditable = false;
  role = "";
  constructor(readonly tagName = "DIV", readonly parent: FocusNode | null = null) {}
  contains(node: FocusNode): boolean {
    return node === this || (node.parent !== null && this.contains(node.parent));
  }
  closest(): FocusNode | null {
    return this.role === "dialog" || this.role === "alertdialog" ? this : this.parent?.closest() ?? null;
  }
  get element() { return this as unknown as HTMLElement; }
}

function page(active: FocusNode | null, body = new FocusNode("BODY")) {
  return {
    activeElement: active?.element ?? null,
    body: body.element,
    documentElement: new FocusNode("HTML").element,
  };
}

test("a registered surface can take keyboard focus from the generic pane", () => {
  const pane = new FocusNode();
  const surface = new FocusNode("DIV", pane);
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, page(pane))).toBe(true);
  expect(shouldRestoreWorkspaceKeyboardFocus(pane.element, page(null))).toBe(true);
});

test("the pane never takes focus back from a surface or an interaction inside it", () => {
  const pane = new FocusNode();
  const surface = new FocusNode("DIV", pane);
  const button = new FocusNode("BUTTON", surface);
  expect(shouldRestoreWorkspaceKeyboardFocus(pane.element, page(surface))).toBe(false);
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, page(surface))).toBe(false);
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, page(button))).toBe(false);
});

test("activation preserves text editors outside the chart surface", () => {
  const surface = new FocusNode();
  for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
    expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, page(new FocusNode(tag)))).toBe(false);
  }
  const editor = new FocusNode();
  editor.isContentEditable = true;
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, page(editor))).toBe(false);
});

test("a dialog opened before deferred focus keeps its keyboard ownership", () => {
  const surface = new FocusNode();
  const state = page(null);
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, state)).toBe(true);
  for (const role of ["dialog", "alertdialog"]) {
    const dialog = new FocusNode();
    dialog.role = role;
    state.activeElement = new FocusNode("BUTTON", dialog).element;
    expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, state)).toBe(false);
  }
});

test("detached focus targets are skipped and abandoned active elements are replaced", () => {
  const surface = new FocusNode();
  const abandoned = new FocusNode();
  abandoned.isConnected = false;
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, page(abandoned))).toBe(true);
  surface.isConnected = false;
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, page(null))).toBe(false);
});

test("body and document-root focus allow chart activation", () => {
  const surface = new FocusNode();
  const state = page(null);
  state.activeElement = state.body;
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, state)).toBe(true);
  state.activeElement = state.documentElement;
  expect(shouldRestoreWorkspaceKeyboardFocus(surface.element, state)).toBe(true);
});

test("Notes gives plain Escape to the shell before the editor can consume it", () => {
  const editorWindow = new EventTarget();
  let focusReturns = 0;
  const unbind = bindNotesEscape(editorWindow, () => { focusReturns += 1; });
  const send = (key: string, options: Partial<KeyboardEvent> = {}) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key, ...options });
    editorWindow.dispatchEvent(event);
    return event.defaultPrevented;
  };

  expect(send("ArrowRight")).toBe(false);
  expect(send("Escape", { isComposing: true })).toBe(false);
  expect(send("Escape", { repeat: true })).toBe(false);
  expect(send("Escape", { altKey: true })).toBe(false);
  expect(send("Escape")).toBe(true);
  expect(focusReturns).toBe(1);
  unbind();
  expect(send("Escape")).toBe(false);
});
