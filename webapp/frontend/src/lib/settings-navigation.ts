// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

const SETTINGS_TAB_IDS = [
  "appearance", "interpretation", "astrocartography", "colors", "export",
  "location", "planets", "orbs", "dignities", "speculum", "fixstars", "asteroids",
  "almutens", "primarydirections", "revolutions", "supplementary",
  "timelords", "relationship", "languages",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];
const SETTINGS_TABS = new Set<string>(SETTINGS_TAB_IDS);
const STORAGE_KEY = "aries-settings-tab";

// Panes folded into Chart display keep resolving there, so a remembered pane,
// an old menu command or a `?tab=` link still opens the right place.
const RETIRED_SETTINGS_TABS: Readonly<Record<string, SettingsTabId>> = {
  houses: "appearance", ayanamsha: "appearance", eclipses: "appearance", mansions: "appearance",
};

export function isSettingsTabId(value: string): value is SettingsTabId {
  return SETTINGS_TABS.has(value);
}

/** The current pane for a pane id, including ids of retired panes. */
export function resolveSettingsTabId(value: string | null | undefined): SettingsTabId | null {
  if (!value) return null;
  if (isSettingsTabId(value)) return value;
  return RETIRED_SETTINGS_TABS[value] ?? null;
}

// Daemon menu grammar: `settings.tab:<id>` (menu-bar pane index) and
// `settings.more:<id>/<submenu>` (a quick submenu's closing "More settings…").
const SETTINGS_PANE_COMMAND = /^settings\.(?:tab|more):([a-z]+)(?:\/.*)?$/;

/** The Settings pane a menu command opens, or null for any other command. */
export function settingsTabForCommand(command: string): SettingsTabId | null {
  return resolveSettingsTabId(SETTINGS_PANE_COMMAND.exec(command)?.[1]);
}

export function readLastSettingsTab(): SettingsTabId {
  try {
    const saved = resolveSettingsTabId(window.localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch { /* Storage may be unavailable during server rendering or recovery. */ }
  return "appearance";
}

export function rememberSettingsTab(tab: SettingsTabId): void {
  try { window.localStorage.setItem(STORAGE_KEY, tab); }
  catch { /* The retained window still remembers its tab for this session. */ }
}
