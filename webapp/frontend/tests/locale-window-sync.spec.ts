// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { codeForLangId, type LocaleCode } from "../src/lib/i18n/langs";
import {
  createWindowLangIdTracker,
  publishWindowLangId,
  subscribeWindowLangId,
} from "../src/lib/shell/locale-window-sync";

const GERMAN = 9;
const JAPANESE = 10;

test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { crypto: globalThis.crypto } });
  mockIPC(() => undefined, { shouldMockEvents: true });
  const bridge = (window as unknown as { __TAURI_INTERNALS__: {
    invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  } }).__TAURI_INTERNALS__;
  const invoke = bridge.invoke;
  bridge.invoke = (command, args) =>
    command === "plugin:event|unlisten" ? invoke(command, { ...args, id: args.eventId }) : invoke(command, args);
});
test.afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(globalThis, "window");
});

/** A companion window (picker, editor) with no daemon socket of its own: it
 * mounts English, subscribes to the relay, and renders whatever it tracks. */
async function mountCompanion() {
  const rendered: LocaleCode[] = ["en"];
  const tracker = createWindowLangIdTracker((langid) => rendered.push(codeForLangId(langid)));
  const stop = await subscribeWindowLangId(tracker.push);
  return { rendered, tracker, stop, current: () => rendered[rendered.length - 1] };
}

test("a retained companion window re-localizes live when the main window switches language", async () => {
  const picker = await mountCompanion();
  const editor = await mountCompanion();

  await publishWindowLangId(JAPANESE);
  await expect.poll(() => [picker.current(), editor.current()]).toEqual(["ja", "ja"]);

  await publishWindowLangId(GERMAN);
  await expect.poll(() => [picker.current(), editor.current()]).toEqual(["de", "de"]);

  await publishWindowLangId(0);
  await expect.poll(() => picker.current()).toBe("en");
  picker.stop();
  editor.stop();
});

test("a prewarmed window's slower startup read cannot revert a language switch relayed meanwhile", async () => {
  const picker = await mountCompanion();
  // The startup options read leaves while the daemon is still English …
  const read = picker.tracker.beginRead();
  // … the user switches to Japanese before it returns …
  await publishWindowLangId(JAPANESE);
  await expect.poll(() => picker.current()).toBe("ja");
  // … and the stale English answer arrives last.
  read.settle(0);
  expect(picker.current()).toBe("ja");

  // A read that races nothing still applies (fresh window, no switch).
  const fresh = picker.tracker.beginRead();
  fresh.settle(GERMAN);
  expect(picker.current()).toBe("de");
  picker.stop();
});

test("an unsubscribed window no longer follows the relay", async () => {
  const picker = await mountCompanion();
  picker.stop();
  await publishWindowLangId(JAPANESE);
  expect(picker.current()).toBe("en");
});
