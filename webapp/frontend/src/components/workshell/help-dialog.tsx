// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  ShortcutEntry,
  WorkspaceManifest,
} from "@/lib/daemon/client";
import { useT, useTFallback } from "@/lib/i18n/i18n";
import {
  LIST_BUTTON_PROPS,
  LIST_PANE_CLASSES,
  LIST_ROLE_CLASSES,
} from "@/lib/list-tokens";
import { useWorkspaceManifest } from "@/stores/use-workspace-manifest";

type ShortcutRow = {
  keys: string;
  action: string;
};

type ShortcutModifierLabels = {
  control: string;
  alt: string;
  shift: string;
};

const TIME_NAVIGATION_KEYS = [
  "← / →",
  "⇧ + ← / →",
  "⌥ + ← / →",
  "↑ / ↓",
  "⇧ + ↑ / ↓",
  "Space",
] as const;
const PRIORITY_SHORTCUT_KEYS = [
  "⇧ ⇧",
  "0–9",
  ...TIME_NAVIGATION_KEYS,
] as const;
const PRIORITY_SHORTCUT_KEY_SET = new Set<string>(PRIORITY_SHORTCUT_KEYS);

type NavigatorPlatform = Pick<Navigator, "platform" | "userAgent"> & {
  userAgentData?: { platform?: string };
};

const subscribeToStaticPlatform = () => () => {};

export function isAppleShortcutPlatform(
  candidate?: NavigatorPlatform | null,
): boolean {
  const current = candidate ?? (
    typeof navigator === "undefined" ? null : navigator as NavigatorPlatform
  );
  if (!current) return true;
  const platform = current.userAgentData?.platform
    || current.platform
    || current.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function formatShortcutKeys(
  keys: string,
  applePlatform: boolean,
  labels: ShortcutModifierLabels,
): string {
  if (applePlatform) return keys;

  const modifierNames: Record<string, string> = {
    "⌘": labels.control,
    "⌃": labels.control,
    "⌥": labels.alt,
    "⇧": labels.shift,
  };
  const repeatedModifier = keys.trim().match(/^([⌘⌃⌥⇧])\s+\1$/);
  if (repeatedModifier) {
    const label = modifierNames[repeatedModifier[1]];
    return `${label} ${label}`;
  }

  const tokens = keys.trim().replace(/\s*\+\s*/g, " ").split(/\s+/);
  const modifiers: string[] = [];
  while (tokens.length > 0 && modifierNames[tokens[0]]) {
    modifiers.push(modifierNames[tokens.shift()!]);
  }
  if (modifiers.length === 0) return keys;
  return [...modifiers, tokens.join(" ")].filter(Boolean).join("+");
}

function useAppleShortcutPlatform(): boolean {
  return React.useSyncExternalStore(
    subscribeToStaticPlatform,
    isAppleShortcutPlatform,
    () => true,
  );
}

const COMMAND_LABEL_KEYS: Record<string, string> = {
  "menu.data": "help.shortcut.editData",
  "toggle-aspects": "help.shortcut.aspects",
  "toggle-houses": "help.shortcut.houses",
  "toggle-inspector": "help.shortcut.inspector",
  "toggle-minor-aspects": "help.shortcut.minorAspects",
  "workspace.close-active": "help.shortcut.closeDocument",
};

function shortcutAction(
  shortcut: ShortcutEntry,
  tf: (key: string, fallback: string) => string,
): string {
  if (shortcut.labelKey) return tf(shortcut.labelKey, shortcut.label);
  const explicitKey = shortcut.commandId
    ? COMMAND_LABEL_KEYS[shortcut.commandId]
    : undefined;
  if (explicitKey) return tf(explicitKey, shortcut.label);
  if (shortcut.commandId) {
    return tf(`sidebar.action.${shortcut.commandId}`, shortcut.label);
  }
  return shortcut.label;
}

export function collectShortcutRows(
  manifest: WorkspaceManifest | null,
  tf: (key: string, fallback: string) => string,
): ShortcutRow[] {
  if (!manifest) return [];

  const rows: ShortcutRow[] = [];
  for (const shortcut of manifest.shortcuts) {
    if (!shortcut.bound || shortcut.hidden || shortcut.keys === "?") continue;
    rows.push({
      keys: shortcut.keys,
      action: shortcutAction(shortcut, tf),
    });
  }

  const seen = new Set<string>();
  const uniqueRows = rows.filter((row) => {
    const key = row.keys.replaceAll(" ", "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const priorityRows = PRIORITY_SHORTCUT_KEYS.flatMap((key) =>
    uniqueRows.filter((row) => row.keys === key),
  );
  const remainingRows = uniqueRows.filter(
    (row) => !PRIORITY_SHORTCUT_KEY_SET.has(row.keys),
  );
  return [...priorityRows, ...remainingRows];
}

function HelpSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-[var(--aries-control-gap)]">
      <h2 className="text-[length:var(--aries-font-size-reading)] font-semibold text-foreground">
        {title}
      </h2>
      <div className="space-y-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-reading)] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

/** Current Aries help, rendered from the live Tauri contracts. The daemon
 * manifest unifies native accelerators, retained frontend handlers, and chart
 * gestures so the manual never advertises an obsolete wx-only binding. */
export function HelpView({ onClose }: { onClose: () => void }) {
  const t = useT();
  const tf = useTFallback();
  const manifest = useWorkspaceManifest();
  const appleShortcutPlatform = useAppleShortcutPlatform();
  const modifierLabels = React.useMemo<ShortcutModifierLabels>(() => ({
    control: t("help.key.control"),
    alt: t("help.key.alt"),
    shift: t("help.key.shift"),
  }), [t]);
  const shortcuts = React.useMemo(
    () => collectShortcutRows(manifest, tf),
    [manifest, tf],
  );

  return (
    <section className={LIST_PANE_CLASSES.root} aria-label={t("help.title")}>
      <header className={LIST_PANE_CLASSES.compactHeader}>
        <h1 className={LIST_PANE_CLASSES.title}>{t("help.title")}</h1>
        <Button
          type="button"
          {...LIST_BUTTON_PROPS.icon}
          onClick={onClose}
          aria-label={t("help.close")}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </header>

      <div className={`${LIST_PANE_CLASSES.scroller} px-[var(--aries-pane-content-padding)] py-[var(--aries-panel-padding-y)]`}>
        <div className="space-y-[var(--aries-section-gap)] pb-[var(--aries-pane-content-padding)]">
          <p className="text-[length:var(--aries-font-size-reading)] leading-relaxed text-muted-foreground">
            {t("help.intro")}
          </p>

          <HelpSection title={t("help.shortcutsTitle")}>
            <p>{t("help.shortcutsIntro")}</p>
            <div className="overflow-hidden rounded-[var(--aries-radius-md)] border border-border">
              <table className={`${LIST_ROLE_CLASSES.standard} w-full table-auto border-collapse text-left text-[length:var(--aries-font-size-reading)]`}>
                <thead className="bg-muted/50 text-foreground">
                  <tr>
                    <th className="aries-list-head whitespace-nowrap border-b border-border font-medium">
                      {t("help.shortcutKey")}
                    </th>
                    <th className="aries-list-head border-b border-border font-medium">
                      {t("help.shortcutFunction")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shortcuts.map((shortcut) => (
                    <tr key={`${shortcut.keys}:${shortcut.action}`} className="aries-list-row border-b border-border/70 last:border-b-0">
                      <td className="aries-list-cell whitespace-nowrap align-top text-foreground">
                        <kbd className="aries-help-kbd">
                          {formatShortcutKeys(
                            shortcut.keys,
                            appleShortcutPlatform,
                            modifierLabels,
                          )}
                        </kbd>
                      </td>
                      <td className="aries-list-cell align-top">{shortcut.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </HelpSection>

          <HelpSection title={t("help.gettingStartedTitle")}>
            <p>{t("help.spotlightGettingStarted")}</p>
            <p>{t("help.gettingStartedBody")}</p>
            <p>{t("help.workspaceBody")}</p>
          </HelpSection>

          <HelpSection title={t("help.chartsTitle")}>
            <p>{t("help.chartsBody")}</p>
            <p>{t("help.timeBody")}</p>
          </HelpSection>

          <HelpSection title={t("help.tablesTitle")}>
            <p>{t("help.tablesBody")}</p>
            <p>{t("help.researchBody")}</p>
          </HelpSection>

          <HelpSection title={t("help.primaryDirectionsTitle")}>
            <p>{t("help.primaryDirectionsConcepts")}</p>
            <p>{t("help.primaryDirectionsSystems")}</p>
            <p>{t("help.primaryDirectionsSettings")}</p>
            <p>{t("help.primaryDirectionsWorkflow")}</p>
            <p>{t("help.primaryDirectionsInChart")}</p>
          </HelpSection>

          <HelpSection title={t("help.filesTitle")}>
            <p>{t("help.filesBody")}</p>
          </HelpSection>
        </div>
      </div>
    </section>
  );
}
