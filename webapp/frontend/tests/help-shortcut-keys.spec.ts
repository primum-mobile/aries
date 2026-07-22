import { expect, test } from "@playwright/test";

import {
  collectShortcutRows,
  formatShortcutKeys,
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

test("Help lists Spotlight and time navigation first without the deleted question-mark row", () => {
  const rows = collectShortcutRows(
    FALLBACK_WORKSPACE_MANIFEST,
    (_key, fallback) => fallback,
  );

  expect(rows.slice(0, 8).map((row) => row.keys)).toEqual([
    "⇧ ⇧",
    "0–9",
    "← / →",
    "⇧ + ← / →",
    "⌥ + ← / →",
    "↑ / ↓",
    "⇧ + ↑ / ↓",
    "Space",
  ]);
  expect(rows.some((row) => row.keys === "?")).toBe(false);
  expect(rows.find((row) => row.keys === "A")?.action).toBe("Aspects");
  expect(rows.find((row) => row.keys === "M")?.action).toBe("Minor aspects");
  expect(rows.find((row) => row.keys === "Q")?.action).toBe("Synodic Cycles");
  expect(rows.find((row) => row.keys === "H")?.action).toBe("Toggle Houses");
});
