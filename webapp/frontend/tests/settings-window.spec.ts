// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit, listen } from "@tauri-apps/api/event";
import { requestSettingsAction, SETTINGS_REQUEST, SETTINGS_REPLY, type SettingsRequest } from "../src/lib/shell/settings-window";

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

test("concurrent settings actions receive their own canonical replies even out of order", async () => {
  const requests: SettingsRequest[] = [];
  const stop = await listen<SettingsRequest>(SETTINGS_REQUEST, async ({ payload }) => {
    requests.push(payload);
    if (requests.length !== 2) return;
    await emit(SETTINGS_REPLY, { id: "unrelated", value: "ignore" });
    for (const request of [...requests].reverse()) {
      await emit(SETTINGS_REPLY, { id: request.id, value: request.action.kind });
    }
  });
  try {
    const replies = await Promise.all([
      requestSettingsAction<string>({ kind: "context" }),
      requestSettingsAction<string>({ kind: "profile", profileId: "source-native" }),
    ]);
    expect(replies).toEqual(["context", "profile"]);
  } finally { stop(); }
});

test("host failures reject the settings action instead of confirming an uncommitted write", async () => {
  const stop = await listen<SettingsRequest>(SETTINGS_REQUEST, ({ payload }) => {
    void emit(SETTINGS_REPLY, { id: payload.id, error: "write rejected" });
  });
  try {
    await expect(requestSettingsAction({ kind: "profile", profileId: "quadrant" })).rejects.toThrow("write rejected");
  } finally { stop(); }
});
