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
import {
  formatShortcutKeys,
  glyphShortcutAvailable,
  isAppleShortcutPlatform,
  useAppleShortcuts,
  useShortcutModifierLabels,
} from "@/lib/shortcut-display";
import { useWorkspaceManifest } from "@/stores/use-workspace-manifest";
import { useUraniaTourStore } from "@/stores/urania-tour-store";

// Existing importers (Help tests, other surfaces) keep their entry point.
export { formatShortcutKeys, isAppleShortcutPlatform };

type ShortcutRow = {
  keys: string;
  action: string;
  actionId?: string;
  manifestGroup: string;
};

const ORDERED_SHORTCUT_SECTIONS = [
  {
    titleKey: "help.shortcuts.chartNavigation",
    actions: [
      "help.shortcut.toggleComparisonOrDashboard", "help.shortcut.resetInitialChart",
      "help.shortcut.contextualStep", "help.shortcut.weekOrListStep",
    ],
  },
  {
    titleKey: "help.shortcuts.transitSteps",
    actions: [
      "help.shortcut.finerStep", "help.shortcut.finestStep", "help.shortcut.secondStep",
      "help.shortcut.lunarQuarter",
    ],
    noteKey: "help.timeBody",
  },
  {
    titleKey: "help.shortcuts.find",
    actions: ["help.shortcut.openSpotlight", "help.shortcut.openSpotlightSeeded", "transit-search"],
  },
];

const CHART_TOOL_ACTIONS = new Set([
  "ascensional-view", "ascensional-transits", "astrocartography", "synastry",
  "open-style-lab", "quick.options.house:next",
]);

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
  if (shortcut.commandId === "ascensional-view") {
    return tf("help.shortcut.ascensionalChart", shortcut.label);
  }
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
  applePlatform = true,
): ShortcutRow[] {
  if (!manifest) return [];

  const rows: ShortcutRow[] = [];
  const seen = new Set<string>();
  for (const shortcut of manifest.shortcuts) {
    if (!shortcut.bound || shortcut.hidden || shortcut.keys === "?") continue;
    if (!glyphShortcutAvailable(shortcut.keys, applePlatform)) continue;
    const chord = shortcut.keys.replaceAll(" ", "").toLowerCase();
    if (seen.has(chord)) continue;
    seen.add(chord);
    rows.push({
      keys: shortcut.keys,
      action: shortcutAction(shortcut, tf),
      actionId: shortcut.commandId ?? shortcut.labelKey,
      manifestGroup: shortcut.group,
    });
  }
  return rows;
}

export function groupShortcutRows(rows: ShortcutRow[]) {
  const remaining = new Set(rows);
  const sections = ORDERED_SHORTCUT_SECTIONS.map(({ titleKey, actions, noteKey }) => {
    const matches = actions.flatMap((action) => rows.filter((row) => row.actionId === action));
    for (const row of matches) remaining.delete(row);
    return { titleKey, rows: matches, noteKey };
  });
  const chartTools = [...remaining].filter(
    (row) => row.manifestGroup === "CHART MODES" || CHART_TOOL_ACTIONS.has(row.actionId ?? ""),
  );
  for (const row of chartTools) remaining.delete(row);
  return [
    ...sections,
    { titleKey: "help.shortcuts.chartTools", rows: chartTools, noteKey: undefined },
    { titleKey: "help.shortcuts.workspace", rows: [...remaining], noteKey: undefined },
  ].filter((section) => section.rows.length > 0);
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
  const appleShortcutPlatform = useAppleShortcuts();
  const modifierLabels = useShortcutModifierLabels();
  const shortcutSections = React.useMemo(
    () => groupShortcutRows(collectShortcutRows(manifest, tf, appleShortcutPlatform)),
    [appleShortcutPlatform, manifest, tf],
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
          <HelpSection title={t("help.shortcutsTitle")}>
            <div className="overflow-hidden rounded-[var(--aries-radius-md)] border border-border">
              <table className={`${LIST_ROLE_CLASSES.standard} w-full table-auto border-collapse text-left text-[length:var(--aries-font-size-reading)]`}>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">{t("help.shortcutKey")}</th>
                    <th scope="col">{t("help.shortcutFunction")}</th>
                  </tr>
                </thead>
                {shortcutSections.map(({ titleKey, rows, noteKey }) => (
                  <tbody key={titleKey}>
                    <tr className="border-b border-border">
                      <th scope="rowgroup" colSpan={2} className="aries-list-head whitespace-normal font-semibold text-foreground">
                        {t(titleKey)}
                      </th>
                    </tr>
                    {rows.map((shortcut) => (
                      <tr key={shortcut.keys} className="aries-list-row border-b border-border/70">
                        <td className="aries-list-cell whitespace-nowrap align-top text-foreground">
                          <kbd className="aries-help-kbd">
                            {shortcut.actionId === "help.shortcut.resetInitialChart" && shortcut.keys === "Space"
                              ? t("help.key.space")
                              : formatShortcutKeys(shortcut.keys, appleShortcutPlatform, modifierLabels)}
                          </kbd>
                        </td>
                        <td className="aries-list-cell whitespace-normal align-top text-foreground">
                          {shortcut.action}
                          {shortcut.actionId === "ascensional-view" && (
                            <p className="whitespace-normal text-muted-foreground">{t("help.shortcut.ascensionalDetail")}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                    {noteKey && (
                      <tr className="border-b border-border">
                        <td colSpan={2} className="aries-list-cell whitespace-normal">{t(noteKey)}</td>
                      </tr>
                    )}
                  </tbody>
                ))}
              </table>
            </div>
          </HelpSection>

          <HelpSection title={t("help.gettingStartedTitle")}>
            <Button type="button" variant="outline" onClick={(event) => {
              onClose();
              useUraniaTourStore.getState().start(event.detail === 0);
            }}>
              {t("urania.replay")}
            </Button>
            <p>{t("help.spotlightGettingStarted")}</p>
            <p>{t("help.gettingStartedBody")}</p>
            <p>{t("help.workspaceBody")}</p>
          </HelpSection>

          <HelpSection title={t("help.chartsTitle")}>
            <p>{t("help.chartsBody")}</p>
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
