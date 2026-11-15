// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { withDesktopSupport } from "../src/components/workshell/browser-menu-bar";
import type { NativeMenuNode } from "../src/lib/daemon/client";
import { systemLocale } from "../src/lib/i18n/i18n";
import {
  describePageError,
  SUPPORT_COMMANDS,
  SUPPORT_DIAGNOSTICS_COMMAND,
  SUPPORT_OPEN_LOGS_COMMAND,
  startupFailureMessage,
  supportDiagnosticsAvailable,
} from "../src/lib/shell/support-diagnostics";

import de from "../src/locales/de.json";
import en from "../src/locales/en.json";
import es from "../src/locales/es.json";
import fr from "../src/locales/fr.json";
import hu from "../src/locales/hu.json";
import it from "../src/locales/it.json";
import ja from "../src/locales/ja.json";
import ko from "../src/locales/ko.json";
import ru from "../src/locales/ru.json";
import tr from "../src/locales/tr.json";
import zhHans from "../src/locales/zh-Hans.json";
import zhHant from "../src/locales/zh-Hant.json";

type SubmenuNode = Extract<NativeMenuNode, { type: "submenu" }>;

const MENUS: SubmenuNode[] = [
  { type: "submenu", id: "menu.file", label: "File", children: [] },
  {
    type: "submenu",
    id: "menu.help",
    label: "Help",
    children: [{ type: "item", id: "menu.help.about", label: "About", enabled: true }],
  },
];

function withRuntime<T>(globals: Record<string, unknown> | undefined, run: () => T): T {
  const target = globalThis as { window?: unknown };
  const previous = target.window;
  if (globals) target.window = globals;
  else delete target.window;
  try {
    return run();
  } finally {
    if (previous === undefined) delete target.window;
    else target.window = previous;
  }
}

const windowsDesktop = { __ARIES_TAURI_RUNTIME__: true, __ARIES_NATIVE_PLATFORM__: "windows" };
const macDesktop = { __ARIES_TAURI_RUNTIME__: true, __ARIES_NATIVE_PLATFORM__: "macos" };
const browserTab = {};

test("support tools exist only in the Windows desktop app", () => {
  expect(withRuntime(windowsDesktop, supportDiagnosticsAvailable)).toBe(true);
  expect(withRuntime(macDesktop, supportDiagnosticsAvailable)).toBe(false);
  expect(withRuntime(browserTab, supportDiagnosticsAvailable)).toBe(false);
  expect(withRuntime(undefined, supportDiagnosticsAvailable)).toBe(false);
});

test("Windows Help menu gains Diagnostics and Open logs folder after a separator", () => {
  const menus = withRuntime(windowsDesktop, () => withDesktopSupport(MENUS));
  const help = menus.find((node) => node.id === "menu.help");
  expect(help?.children.map((node) => node.type === "separator" ? "---" : node.id)).toEqual([
    "menu.help.about",
    "---",
    SUPPORT_DIAGNOSTICS_COMMAND,
    SUPPORT_OPEN_LOGS_COMMAND,
  ]);
  expect(menus.find((node) => node.id === "menu.file")).toBe(MENUS[0]);
  expect(SUPPORT_COMMANDS).toEqual([SUPPORT_DIAGNOSTICS_COMMAND, SUPPORT_OPEN_LOGS_COMMAND]);
});

test("macOS and the browser keep the menu unchanged", () => {
  expect(withRuntime(macDesktop, () => withDesktopSupport(MENUS))).toBe(MENUS);
  expect(withRuntime(browserTab, () => withDesktopSupport(MENUS))).toBe(MENUS);
});

test("startup failure text follows the first shipped system language", () => {
  expect(systemLocale(["de-DE", "en-US"])).toBe("de");
  expect(systemLocale(["pt-BR", "ja"])).toBe("ja");
  expect(systemLocale(["FR-ca"])).toBe("fr");
  expect(systemLocale(["ko-KR"])).toBe("en");
  expect(systemLocale([])).toBe("en");
});

test("a recognised spawn error names its cause", () => {
  const failure = (reason: string, cause?: string | null) => ({
    reason,
    exitCode: null,
    detail: null,
    cause,
    logDir: null,
  });
  const key = (text: string) => text;
  expect(startupFailureMessage(key, failure("spawn", "missing"))).toBe("supportDiagnostics.startupSpawnMissing");
  expect(startupFailureMessage(key, failure("spawn", "blocked"))).toBe("supportDiagnostics.startupSpawnBlocked");
  expect(startupFailureMessage(key, failure("spawn", null))).toBe("supportDiagnostics.startupSpawn");
  expect(startupFailureMessage(key, failure("spawn"))).toBe("supportDiagnostics.startupSpawn");
  expect(startupFailureMessage(key, failure("exited", "missing"))).toBe("supportDiagnostics.startupExited");
  expect(startupFailureMessage(key, failure("timeout"))).toBe("supportDiagnostics.startupTimeout");
});

test("page errors are described with their stack", () => {
  const error = new TypeError("x is undefined");
  expect(describePageError(error, "fallback")).toContain("TypeError: x is undefined");
  expect(describePageError("plain", "fallback")).toBe("plain");
  expect(describePageError({ code: 7 }, "fallback")).toBe('{"code":7}');
  expect(describePageError(undefined, "fallback")).toBe("fallback");
});

test("every support string is translated in every shipped catalog", () => {
  const catalogs: Record<string, Record<string, string>> = {
    de, en, es, fr, hu, it, ja, ko, ru, tr, "zh-Hans": zhHans, "zh-Hant": zhHant,
  };
  const keys = Object.keys(en).filter((key) => key.startsWith("supportDiagnostics."));
  expect(keys.length).toBe(21);
  for (const [code, catalog] of Object.entries(catalogs)) {
    for (const key of keys) {
      expect(catalog[key], `${code} ${key}`).toBeTruthy();
      const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(catalog[key]), `${code} ${key}`).toEqual(placeholders((en as Record<string, string>)[key]));
      if (code !== "en") {
        expect(catalog[key], `${code} ${key} is translated`).not.toBe((en as Record<string, string>)[key]);
      }
    }
  }
});
