// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  collectShortcutRows,
  formatShortcutKeys,
  groupShortcutRows,
  isAppleShortcutPlatform,
} from "../src/components/workshell/help-dialog";
import { FALLBACK_WORKSPACE_MANIFEST } from "../src/lib/daemon/fallback-workspace-manifest";

const labels = { control: "Ctrl", alt: "Alt", shift: "Shift" };

test("Help preserves canonical shortcut glyphs on Apple platforms", () => {
  expect(formatShortcutKeys("⌘ ⇧ S", true, labels)).toBe("⌘ ⇧ S");
  expect(formatShortcutKeys("⌥ + ← / →", true, labels)).toBe("⌥ + ← / →");
});

test("Help formats modifier chords conventionally on Windows and Linux", () => {
  expect(formatShortcutKeys("⌘ ⇧ S", false, labels)).toBe("Ctrl+Shift+S");
  expect(formatShortcutKeys("⌃ F11", false, labels)).toBe("Ctrl+F11");
  expect(formatShortcutKeys("⌘ ⌥ A", false, labels)).toBe("Ctrl+Alt+A");
  expect(formatShortcutKeys("⇧ + ← / →", false, labels)).toBe("Shift+← / →");
  expect(formatShortcutKeys("⌥ + ← / →", false, labels)).toBe("Alt+← / →");
  expect(formatShortcutKeys("⇧ ⇧", false, labels)).toBe("Shift Shift");
  expect(formatShortcutKeys("Space", false, labels)).toBe("Space");
  expect(formatShortcutKeys("⌘ ⇧ S", false, {
    control: "Strg",
    alt: "Alt",
    shift: "Umschalt",
  })).toBe("Strg+Umschalt+S");
});

test("Help detects Apple platforms without assuming navigator fields", () => {
  expect(isAppleShortcutPlatform({ platform: "MacIntel", userAgent: "" })).toBe(true);
  expect(isAppleShortcutPlatform({ platform: "", userAgent: "iPhone" })).toBe(true);
  expect(isAppleShortcutPlatform({ platform: "Win32", userAgent: "" })).toBe(false);
  expect(isAppleShortcutPlatform({ platform: "Linux x86_64", userAgent: "" })).toBe(false);
  expect(isAppleShortcutPlatform({
    platform: "Win32",
    userAgent: "",
    userAgentData: { platform: "macOS" },
  })).toBe(true);
});

test("Help puts everyday chart controls first, then groups the full reference by task", () => {
  const rows = collectShortcutRows(
    FALLBACK_WORKSPACE_MANIFEST,
    (_key, fallback) => fallback,
  );

  const sections = groupShortcutRows(rows);
  expect(sections.map((section) => section.titleKey)).toEqual([
    "help.shortcuts.chartNavigation", "help.shortcuts.transitSteps",
    "help.shortcuts.find", "help.shortcuts.chartTools", "help.shortcuts.workspace",
  ]);
  expect(sections[0].rows.map((row) => row.keys)).toEqual(["Tab", "Space", "← / →", "↑ / ↓"]);
  expect(sections[1].rows.map((row) => row.keys)).toEqual([
    "⇧ + ← / →", "⌥ + ← / →", "⇧ + ⌥ + ← / →", "⇧ + ↑ / ↓",
  ]);
  expect(sections[2].rows.map((row) => row.keys)).toEqual(["⇧ ⇧", "0–9", "⌘ F"]);
  expect(sections[3].rows.map((row) => row.keys)).toContain("⌥ A");
  expect(sections[4].rows.map((row) => row.keys)).toContain("⌘ S");
  expect(sections.flatMap((section) => section.rows.map((row) => row.keys)).sort())
    .toEqual(rows.map((row) => row.keys).sort());
  expect(rows.some((row) => row.keys === "?")).toBe(false);
  expect(rows.find((row) => row.keys === "A")?.action).toBe("Aspects");
  expect(rows.find((row) => row.keys === "M")?.action).toBe("Minor aspects");
  expect(rows.find((row) => row.keys === "Q")?.action).toBe("Synodic Cycles");
  expect(rows.find((row) => row.keys === "H")?.action).toBe("Toggle Houses");
});

test("Help groups chart controls by their action and uses its own Ascensional copy", () => {
  const manifest = structuredClone(FALLBACK_WORKSPACE_MANIFEST);
  const tab = manifest.shortcuts.find((row) => row.keys === "Tab")!;
  tab.keys = "F4";
  const rows = collectShortcutRows(manifest, (key) => key);
  expect(groupShortcutRows(rows)[0].rows.map((row) => row.keys)).toEqual(["F4", "Space", "← / →", "↑ / ↓"]);
  expect(rows.find((row) => row.keys === "⌥ A")?.action).toBe("help.shortcut.ascensionalChart");
});
