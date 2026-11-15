// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { collectShortcutRows } from "../src/components/workshell/help-dialog";
import type { WorkspaceManifest } from "../src/lib/daemon/client";
import { FALLBACK_WORKSPACE_MANIFEST } from "../src/lib/daemon/fallback-workspace-manifest";
import { clampTourRect, pressedKeyToken, TOUR_ROW_LABELS, tourShortcutEntries, tourShortcutParts, uraniaHoldsNavigationBar, uraniaIllustration, URANIA_STEPS } from "../src/lib/urania-tour";
import { createUraniaTourStore, URANIA_SEEN_KEY } from "../src/stores/urania-tour-store";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("first-run offer is once per session, and Skip survives a new session", () => {
  const storage = memoryStorage();
  const first = createUraniaTourStore(() => storage);
  first.getState().offer();
  first.getState().next();
  first.getState().offer();
  expect(first.getState().step).toBe(1);
  first.getState().dismiss();
  expect(storage.getItem(URANIA_SEEN_KEY)).toBe("1");
  const second = createUraniaTourStore(() => storage);
  second.getState().offer();
  expect(second.getState().step).toBeNull();
  second.getState().start();
  expect(second.getState().step).toBe(0);
});

test("only dismissal or completing the last step marks the tour seen", () => {
  const storage = memoryStorage();
  const tour = createUraniaTourStore(() => storage);
  tour.getState().start();
  tour.getState().back();
  expect(tour.getState().step).toBe(0);
  for (let index = 1; index < URANIA_STEPS.length; index++) tour.getState().next();
  expect(storage.getItem(URANIA_SEEN_KEY)).toBeNull();
  tour.getState().next();
  expect(tour.getState().step).toBeNull();
  expect(storage.getItem(URANIA_SEEN_KEY)).toBe("1");
  tour.getState().back();
  tour.getState().next();
  expect(tour.getState().step).toBeNull();
});

test("unavailable storage never prevents dismissal or replay", () => {
  const tour = createUraniaTourStore(() => { throw new Error("storage unavailable"); });
  tour.getState().offer();
  expect(tour.getState().step).toBe(0);
  tour.getState().dismiss();
  tour.getState().offer();
  expect(tour.getState().step).toBeNull();
  tour.getState().start();
  expect(tour.getState().step).toBe(0);
});

test("automatic offers leave chart focus alone; keyboard replay requests control focus once", () => {
  const tour = createUraniaTourStore(() => memoryStorage());
  tour.getState().offer();
  expect(tour.getState().focusRequested).toBe(false);
  tour.getState().start(true);
  expect(tour.getState().focusRequested).toBe(true);
  tour.getState().focusHandled();
  tour.getState().next();
  expect(tour.getState().focusRequested).toBe(false);
  tour.getState().start(true);
  tour.getState().dismiss();
  expect(tour.getState().focusRequested).toBe(false);
});

test("the first automatic offer waits for the chart and prepares it only once", async () => {
  const storage = memoryStorage();
  const tour = createUraniaTourStore(() => storage);
  let complete = () => {};
  const opening = new Promise<void>((resolve) => { complete = resolve; });
  let opens = 0;
  const prepare = () => { opens++; return opening; };
  const offer = tour.getState().offer(prepare);
  expect(tour.getState().step).toBeNull();
  await tour.getState().offer(prepare);
  complete();
  await offer;
  expect(tour.getState().step).toBe(0);
  tour.getState().dismiss();
  const nextSession = createUraniaTourStore(() => storage);
  await nextSession.getState().offer(prepare);
  expect(nextSession.getState().step).toBeNull();
  expect(opens).toBe(1);
});

test("tutorial shortcuts follow semantic manifest entries and ignore unbound commands", () => {
  const manifest: WorkspaceManifest = structuredClone(FALLBACK_WORKSPACE_MANIFEST);
  const entries = (step: (typeof URANIA_STEPS)[number]["id"]) => tourShortcutEntries(step, manifest);
  expect(entries("techniques").map((entry) => entry.keys)).toEqual(["R", "T", "D", "P", "S", "L"]);
  const transit = manifest.shortcuts.find((entry) => entry.commandId === "transits")!;
  transit.keys = "Y";
  const rows = collectShortcutRows(manifest, (_key, fallback) => fallback);
  expect(entries("techniques").map((entry) => entry.keys)).toEqual(["R", "Y", "D", "P", "S", "L"]);
  expect(rows.find((row) => row.keys === "Y")).toMatchObject({ actionId: "transits", action: transit.label });
  manifest.shortcuts.unshift({ keys: "Y", label: "Unrelated", commandId: "unrelated", group: "WORKSPACE", bound: true });
  const winningRows = collectShortcutRows(manifest, (_key, fallback) => fallback);
  expect(winningRows.find((row) => row.keys === "Y")).toMatchObject({ actionId: "unrelated" });
  transit.bound = false;
  expect(entries("techniques").map((entry) => entry.keys)).toEqual(["R", "D", "P", "S", "L"]);
  // Tab leads the views card, then the display toggles.
  expect(entries("views").map((entry) => entry.keys)).toEqual(["Tab", "H", "A", "M"]);
  expect(entries("inspector").map((entry) => entry.keys)).toEqual(["I"]);
  expect(entries("time").map((entry) => entry.keys)).toEqual(["← / →", "⇧ + ← / →", "⌥ + ← / →", "↑ / ↓", "Space"]);
});

test("chapter dots jump within the open tour only", () => {
  const tour = createUraniaTourStore(() => memoryStorage());
  tour.getState().go(3);
  expect(tour.getState().step).toBeNull();
  tour.getState().start();
  tour.getState().go(4);
  expect(tour.getState().step).toBe(4);
  tour.getState().go(-2);
  expect(tour.getState().step).toBe(0);
  tour.getState().go(URANIA_STEPS.length + 5);
  expect(tour.getState().step).toBe(URANIA_STEPS.length - 1);
});

test("brief row labels belong to shortcuts the tour shows and are authored", () => {
  const english = JSON.parse(readFileSync(resolve(process.cwd(), "src/locales/en.json"), "utf8"));
  const shown = new Set(URANIA_STEPS.flatMap((step) =>
    tourShortcutEntries(step.id, FALLBACK_WORKSPACE_MANIFEST).map((entry) => entry.commandId ?? entry.labelKey),
  ));
  for (const [actionId, labelKey] of Object.entries(TOUR_ROW_LABELS)) {
    expect(shown.has(actionId), actionId).toBe(true);
    expect(english[labelKey], labelKey).toBeTruthy();
  }
});

test("the time step targets only the shown navigation bar and holds it revealed while current", () => {
  const time = URANIA_STEPS.find((step) => step.id === "time");
  expect(time?.targets).toEqual(['.aries-mode-hint:not([aria-hidden="true"])']);
  expect(time?.fallback).toBe("[data-workspace-focus-anchor]");
  const tour = createUraniaTourStore(() => memoryStorage());
  const holds = () => uraniaHoldsNavigationBar(tour.getState().step);
  expect(holds()).toBe(false);
  tour.getState().start();
  const timeIndex = URANIA_STEPS.findIndex((step) => step.id === "time");
  for (let index = 0; index < timeIndex; index++) {
    expect(holds()).toBe(false);
    tour.getState().next();
  }
  expect(holds()).toBe(true);
  tour.getState().next();
  expect(holds()).toBe(false);
  tour.getState().back();
  expect(holds()).toBe(true);
  tour.getState().dismiss();
  expect(holds()).toBe(false);
});

test("every step carries its own sketch", () => {
  expect(URANIA_STEPS.map((step) => [step.id, uraniaIllustration(step)])).toEqual([
    ["workspace", "areas"], ["inspector", "hoverInspect"], ["menus", "contextMenu"], ["views", "viewSwap"],
    ["techniques", "techniqueKeys"], ["time", "timeSteps"], ["finish", "helpMenu"],
  ]);
  const source = readFileSync(resolve(process.cwd(), "src/components/workshell/urania-walkthrough.tsx"), "utf8");
  for (const step of URANIA_STEPS) expect(source, step.id).toContain(`  ${uraniaIllustration(step)}: () =>`);
});

test("the card is sized by its content: no body scroll or height cap outside phones", () => {
  const css = readFileSync(resolve(process.cwd(), "src/components/workshell/urania-walkthrough.module.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const desktop = rules.filter(({ selector }) => !selector.includes("data-aries-mobile"));
  for (const { selector, body } of desktop.filter(({ selector }) => /\.(speech|bubble|guide|guideDocked|shortcuts)\b/.test(selector))) {
    expect(body, selector).not.toMatch(/max-height|overflow(-y)?\s*:\s*(auto|scroll|hidden)/);
  }
  // One row per shortcut: keycaps column, label column, rows flattened into the grid.
  expect(rules.find(({ selector }) => selector === ".shortcuts")?.body).toMatch(/grid-template-columns:\s*auto 1fr/);
  expect(rules.find(({ selector }) => selector === ".shortcuts > div")?.body).toMatch(/display:\s*contents/);
  // Sketch motion is off under reduced motion; the resting style is the final frame.
  expect(css).toMatch(/prefers-reduced-motion[^}]*\.sketch \*[^}]*animation: none/);
});

test("highlight boxes exclude collapsed or offscreen areas and clamp to the window", () => {
  expect(clampTourRect({ left: -200, top: 0, width: 180, height: 600 }, 1000, 700)).toBeNull();
  expect(clampTourRect({ left: 900, top: 600, width: 300, height: 200 }, 1000, 700))
    .toEqual({ left: 900, top: 600, width: 100, height: 100 });
  expect(clampTourRect({ left: 0, top: 0, width: 0, height: 600 }, 1000, 700)).toBeNull();
});

test("pressed keys map to the keycap glyphs the tour shows", () => {
  const press = (key: string, code = "", apple = true) => pressedKeyToken({ key, code }, apple);
  expect(press("ArrowLeft")).toBe("←");
  expect(press("Shift")).toBe("⇧");
  expect(press("Alt")).toBe("⌥");
  expect(press(" ", "Space")).toBe("Space");
  expect(press("Tab", "Tab")).toBe("Tab");
  // Layout-independent letters: ⌥T reports "†" on macOS but code KeyT.
  expect(press("†", "KeyT")).toBe("T");
  expect(press("Meta")).toBe("⌘");
  expect(press("Control")).toBe("⌃");
  // Off Apple platforms the manifest's ⌘ is Ctrl, and Meta is the OS key.
  expect(press("Control", "", false)).toBe("⌘");
  expect(press("Meta", "", false)).toBeNull();
  expect(press("Escape", "Escape")).toBeNull();
});

test("keycaps keep Tab, individual keys, and chord separators distinct", () => {
  expect(tourShortcutParts("Tab")).toEqual([{ key: "Tab" }]);
  expect(tourShortcutParts("⇧ + ← / →")).toEqual([
    { key: "⇧" }, { key: "←", separator: "+" }, { key: "⇧", separator: "/" }, { key: "→", separator: "+" },
  ]);
  expect(tourShortcutParts("⌥ + ← / →")).toEqual([
    { key: "⌥" }, { key: "←", separator: "+" }, { key: "⌥", separator: "/" }, { key: "→", separator: "+" },
  ]);
  expect(tourShortcutParts("⌘ ⇧ S")).toEqual([
    { key: "⇧" }, { key: "⌘", separator: "+" }, { key: "S", separator: "+" },
  ]);
});

test("every tour string is authored in every shipped locale, with placeholders intact", () => {
  const root = resolve(process.cwd(), "src/locales");
  const english = JSON.parse(readFileSync(resolve(root, "en.json"), "utf8"));
  const keys = Object.keys(english).filter((key) => key.startsWith("urania."));
  expect(keys.length).toBeGreaterThan(20);
  keys.push("help.key.tab", "help.key.space");
  for (const file of readdirSync(root).filter((name) => name.endsWith(".json"))) {
    const bundle = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    for (const key of keys) {
      expect(bundle[key], `${file}: ${key}`).toBeTruthy();
      expect(bundle[key].match(/\{\w+\}/g)?.sort() ?? [], `${file}: ${key}`)
        .toEqual(english[key].match(/\{\w+\}/g)?.sort() ?? []);
    }
  }
});
