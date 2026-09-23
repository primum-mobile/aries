// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import {newerToolWindowIntent} from "../src/lib/shell/tool-window-lifecycle";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit, listen } from "@tauri-apps/api/event";
import { requestEditorWindowAction, EDITOR_REQUEST, EDITOR_REPLY, type EditorWindowRequest } from "../src/lib/shell/chart-editor-window";

test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { crypto: globalThis.crypto } });
  mockIPC(() => undefined, { shouldMockEvents: true });
  // Tauri's event mock implements emit but not targeted emitTo yet.
  const bridge = (window as unknown as { __TAURI_INTERNALS__: {
    invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  } }).__TAURI_INTERNALS__;
  const invoke = bridge.invoke;
  bridge.invoke = (command, args) => {
    if (command === "plugin:event|emit_to") {
      expect(args.target).toEqual({ kind: "AnyLabel", label: "main" });
      return invoke("plugin:event|emit", args);
    }
    if (command === "plugin:event|unlisten") {
      return invoke(command, { ...args, id: args.eventId });
    }
    return invoke(command, args);
  };
});
test.afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(globalThis, "window");
});

test("concurrent editor actions receive their own canonical replies even out of order", async () => {
  const requests: EditorWindowRequest[] = [];
  const stop = await listen<EditorWindowRequest>(EDITOR_REQUEST, async ({ payload }) => {
    requests.push(payload);
    if (requests.length !== 2) return;
    await emit(EDITOR_REPLY, { id: "unrelated", context: {id: "ignore", editTarget: null} });
    for (const request of [...requests].reverse()) {
      await emit(EDITOR_REPLY, { id: request.id, context: {id: request.action.kind, editTarget: null} });
    }
  });
  try {
    const replies = await Promise.all([
      requestEditorWindowAction({ kind: "context" }),
      requestEditorWindowAction({ kind: "flush-notes" }),
    ]);
    expect(replies).toEqual([{id: "context", editTarget: null}, {id: "flush-notes", editTarget: null}]);
  } finally { stop(); }
});

test("host failures reject the editor action instead of confirming an uncommitted write", async () => {
  const stop = await listen<EditorWindowRequest>(EDITOR_REQUEST, ({ payload }) => {
    void emit(EDITOR_REPLY, { id: payload.id, error: "write rejected" });
  });
  try {
    await expect(requestEditorWindowAction({ kind: "saved", name: "Example", collection: "charts.jsonl", recordIndex: 0 })).rejects.toThrow("write rejected");
  } finally { stop(); }
});


test("a retained native window ignores an old boot reply after a newer open or close", async () => {
  const latest = {generation: 4, open: true, context: {chart: "current"}};
  expect(newerToolWindowIntent(latest, {generation: 1, open: false, context: null})).toBe(latest);
  const closed = newerToolWindowIntent(latest, {generation: 5, open: false, context: null});
  expect(closed.open).toBe(false);
  expect(newerToolWindowIntent(closed, latest)).toBe(closed);
  const next = {generation: 6, open: true, context: {chart: "next"}};
  expect(newerToolWindowIntent(closed, next)).toBe(next);
});
