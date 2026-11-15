// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ShortcutEntry, WorkspaceManifest } from "@/lib/daemon/client";
import { parseGlyphChord } from "@/lib/shortcut-display";

const SIDEBAR = '[data-slot="sidebar"][data-state="expanded"] [data-slot="sidebar-container"]';
const CHART = '[data-workspace-focus-anchor]';
const TOOLBAR = '[data-urania-target="toolbar"]';
const NAVIGATION = '[data-urania-target="navigation"]';
const PANE = '[data-right-pane-module]:not([aria-hidden="true"])';
/** The chart's time navigation bar while it is shown (the time step holds it revealed). */
const NAVIGATION_BAR = '.aries-mode-hint:not([aria-hidden="true"])';

export const URANIA_STEPS = [
  { id: "workspace", title: "urania.workspace.title", body: "urania.workspace.body", pose: "welcome", targets: [SIDEBAR, NAVIGATION, TOOLBAR], fallback: '[data-slot="sidebar-inset"]', illustration: "areas" },
  { id: "inspector", title: "urania.inspector.title", body: "urania.inspector.body", pose: "point", targets: ['[data-right-pane-module="hover-inspector"]', '[data-right-pane-module="inspector-notes"]', TOOLBAR], fallback: CHART, illustration: "hoverInspect" },
  { id: "menus", title: "urania.menus.title", body: "urania.menus.body", pose: "smile", targets: [CHART, SIDEBAR, PANE], fallback: '[data-slot="sidebar-inset"]', illustration: "contextMenu" },
  { id: "views", title: "urania.views.title", body: "urania.views.body", pose: "point", targets: [CHART], fallback: '[data-slot="sidebar-inset"]', illustration: "viewSwap" },
  { id: "techniques", title: "urania.techniques.title", body: "urania.techniques.body", pose: "welcome", targets: [SIDEBAR], fallback: NAVIGATION, illustration: "techniqueKeys" },
  { id: "time", title: "urania.time.title", body: "urania.time.body", pose: "point", targets: [NAVIGATION_BAR], fallback: CHART, illustration: "timeSteps" },
  { id: "finish", title: "urania.finish.title", body: "urania.finish.body", pose: "float", targets: [TOOLBAR], fallback: SIDEBAR, illustration: "helpMenu" },
] as const;

export type UraniaStep = (typeof URANIA_STEPS)[number];

/** UI only: while the time step is current, the chart navigation bar stays revealed as if hovered. */
export function uraniaHoldsNavigationBar(step: number | null): boolean {
  return step !== null && URANIA_STEPS[step]?.id === "time";
}
export type UraniaIllustration = "areas" | "contextMenu" | "viewSwap" | "techniqueKeys" | "timeSteps" | "hoverInspect" | "helpMenu";

/** The optional sketch a step carries in its card. */
export function uraniaIllustration(step: UraniaStep): UraniaIllustration | undefined {
  return "illustration" in step ? step.illustration : undefined;
}
export type TourRect = { left: number; top: number; width: number; height: number };

/** Keep each physical key separate and preserve the manifest's chord/choice separators. */
export function tourShortcutParts(keys: string): { key: string; separator?: string }[] {
  const choices = keys.trim().split(/\s+\/\s+/);
  const first = parseGlyphChord(choices[0]);
  return choices.flatMap((choice, index) => {
    // In the time-step manifest, modifiers before ← also apply to →.
    const chord = first?.key === "←" && choice === "→" && choices.length === 2
      ? { ...first, key: choice }
      : parseGlyphChord(choice);
    const caps = chord ? [
      chord.control ? "⌃" : "",
      chord.alt ? "⌥" : "",
      chord.shift ? "⇧" : "",
      chord.command ? "⌘" : "",
      chord.key,
    ].filter(Boolean) : [choice];
    return caps.map((key, position) => ({ key, separator: position ? "+" : index ? "/" : undefined }));
  });
}

/** Help's full shortcut labels, said briefly where the card's copy already explains them. */
export const TOUR_ROW_LABELS: Record<string, string> = {
  "help.shortcut.toggleComparisonOrDashboard": "urania.views.key",
  "help.shortcut.contextualStep": "urania.time.day",
  "help.shortcut.finerStep": "urania.time.hour",
  "help.shortcut.finestStep": "urania.time.minute",
  "help.shortcut.weekOrListStep": "urania.time.week",
  "help.shortcut.resetInitialChart": "urania.time.reset",
};

/** Each step's shortcuts in card order. Select by action (command or Help label)
 *  before formatting, so remapped keys keep their own labels. */
const TOUR_SHORTCUTS: Partial<Record<UraniaStep["id"], ({ command: string } | { label: string })[]>> = {
  inspector: [{ command: "toggle-inspector" }],
  views: [
    { label: "help.shortcut.toggleComparisonOrDashboard" },
    { command: "toggle-houses" }, { command: "toggle-aspects" }, { command: "toggle-minor-aspects" },
  ],
  techniques: [
    { command: "solar-revolution" }, { command: "transits" }, { command: "directions" },
    { command: "profections" }, { command: "secondary-progression" }, { command: "lunar-revolution" },
  ],
  time: [
    { label: "help.shortcut.contextualStep" }, { label: "help.shortcut.finerStep" }, { label: "help.shortcut.finestStep" },
    { label: "help.shortcut.weekOrListStep" }, { label: "help.shortcut.resetInitialChart" },
  ],
};

export function tourShortcutEntries(step: UraniaStep["id"], manifest: WorkspaceManifest | null): ShortcutEntry[] {
  const entries = manifest?.shortcuts ?? [];
  return (TOUR_SHORTCUTS[step] ?? []).flatMap((wanted) => {
    const entry = entries.find((candidate) => candidate.bound && !candidate.hidden &&
      ("command" in wanted ? candidate.commandId === wanted.command : candidate.labelKey === wanted.label));
    return entry ? [entry] : [];
  });
}

/** Keyboard event → the manifest glyph its keycap carries (⌘ means Ctrl off Apple). */
export function pressedKeyToken(event: Pick<KeyboardEvent, "key" | "code">, apple: boolean): string | null {
  switch (event.key) {
    case "Shift": return "⇧";
    case "Alt": return "⌥";
    case "Meta": return apple ? "⌘" : null;
    case "Control": return apple ? "⌃" : "⌘";
    case "ArrowLeft": return "←";
    case "ArrowRight": return "→";
    case "ArrowUp": return "↑";
    case "ArrowDown": return "↓";
    case "Tab": return "Tab";
    case " ": return "Space";
  }
  return /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : null;
}

export function clampTourRect(rect: TourRect, width: number, height: number): TourRect | null {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(width, rect.left + rect.width);
  const bottom = Math.min(height, rect.top + rect.height);
  return right - left > 4 && bottom - top > 4
    ? { left, top, width: right - left, height: bottom - top }
    : null;
}
