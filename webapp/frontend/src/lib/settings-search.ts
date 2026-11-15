// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OptionsPayload } from "./daemon/client";
import { isSettingsTabId, type SettingsTabId } from "./settings-navigation";
import { COLOR_GROUP_TITLE_KEYS, PD_SYSTEM_LABEL_KEYS, SETTINGS_SEARCH_FIELDS } from "./settings-search-fields";

export type PrimaryDirectionsSettingsTab = "calculation" | "chart" | "list";

type SearchOptions = Pick<OptionsPayload, "settingsRegistry" | "houseSystem" | "ayanamsha" | "catalog" | "languages">;

export type SettingsSearchTarget = {
  tab: SettingsTabId;
  anchor?: string;
  sectionAnchor?: string;
  directionsTab?: PrimaryDirectionsSettingsTab;
};

export type SettingsSearchResult = SettingsSearchTarget & {
  id: string;
  label: string;
  path: string[];
};

type SearchEntry = SettingsSearchResult & {
  labelText: string;
  pathText: string;
  names: string[];
  ownText: string;
};

const DIRECTIONS_TABS = {
  calculation: "primdir.calculationTab",
  chart: "primdir.chartTab",
  list: "primdir.listTab",
} as const;

const DIRECTIONS_FIELDS = {
  calculation: [
    "primdir.enginePreset", "primdir.houseSystem", "primdir.keys", "primdir.chartPositions",
    "primdir.sectionMode", "primdir.converseCalculation", "primdir.useLatitudeOf",
    "primdir.zodiacalOptions", "primdir.promissors", "primdir.aspects", "primdir.significators",
    "primdir.circumambulationMethod", "primdir.revolutions",
  ],
  chart: ["primdir.terrestrialChartProjection", "primdir.planetarySecondaryMotion"],
  list: ["primdir.listView", "primdir.coloredGlyphRows"],
} satisfies Record<PrimaryDirectionsSettingsTab, string[]>;

function normalize(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function translationKey(anchor: string): string {
  return anchor.split("#", 1)[0];
}

export function buildSettingsSearchIndex(opts: SearchOptions, t: (key: string) => string): SearchEntry[] {
  const entries: SearchEntry[] = [];
  function add(target: SettingsSearchTarget, label: string, path: string[], aliases: string[] = [], choiceId?: number) {
    const labelText = normalize(label);
    const names = [labelText, ...aliases.map(normalize)];
    entries.push({
      ...target,
      id: [target.tab, target.directionsTab, target.anchor, choiceId].filter(part => part !== undefined).join("/"),
      label,
      path,
      labelText,
      pathText: normalize(path.join(" ")),
      names,
      ownText: names.join(" "),
    });
  }

  const cat = opts.catalog;
  const choiceLabels = (choices: readonly { label: string }[]) => choices.map(choice => choice.label);
  const optionChoices: Partial<Record<SettingsTabId, Record<string, string[]>>> = {
    appearance: {
      "settings.typeface": choiceLabels(cat.fontProfiles),
      "settings.dateFormat": choiceLabels(cat.dateConventions),
      "settings.doctrine": cat.solarConditionModes.map(mode => t(mode.labelKey)),
      "settings.doctrine#2": cat.voidCoursePolicies.map(policy => t(policy.labelKey)),
      "settings.mode#2": choiceLabels(cat.phasisModes),
      "settings.mode#3": choiceLabels(cat.cazimiModes),
      "settings.shiftArrow": choiceLabels(cat.synodicModes),
      "settings.openEclipseChartsAt": choiceLabels(cat.eclipseModes),
      "settings.zodiacForManazil": choiceLabels(cat.mansionZodiacModes),
      "settings.referencePoint": choiceLabels(cat.syzygyModes),
      "settings.ayanamsha": ["ayanamsa", "ayanamsza"],
    },
    dignities: { "settings.activeTerms": choiceLabels(cat.termSets) },
    languages: { "settings.activeLanguage": choiceLabels(opts.languages.available) },
    planets: {
      "settings.nodeCalculation": [t("primdir.meanNode"), t("primdir.trueNode"), ...choiceLabels(cat.nodeModes)],
    },
    relationship: { "settings.openFirst": choiceLabels(cat.relationshipLauncherModes) },
    speculum: { "settings.speculumSpeedDisplay": choiceLabels(cat.speculumSpeedModes) },
    supplementary: {
      "settings.progressedAngles": choiceLabels(cat.progressionAngleMethods),
      "settings.dayType": choiceLabels(cat.progressionDayTypes),
      "settings.progressionsTransits": choiceLabels(cat.secondaryLaunchModes),
      "settings.tableTimes": choiceLabels(cat.eventTableTimeModes),
    },
    timelords: { "settings.nocturnalOrder": choiceLabels(cat.firdariaModes) },
  };

  for (const category of opts.settingsRegistry.tabs) {
    const tab = category.id;
    if (!isSettingsTabId(tab)) continue;
    const categoryLabel = t(category.labelKey);
    add({ tab }, categoryLabel, []);

    for (const [section, ...fields] of SETTINGS_SEARCH_FIELDS[tab] ?? []) {
      const sectionKey = section && translationKey(section);
      const sectionLabel = sectionKey && t(sectionKey);
      const sectionAnchor = section ? `section:${section}` : undefined;
      const fieldPath = sectionLabel && sectionLabel !== categoryLabel
        ? [categoryLabel, sectionLabel] : [categoryLabel];
      if (sectionLabel && sectionLabel !== categoryLabel && !fields.some(field => field === section)) {
        add({ tab, anchor: sectionAnchor }, sectionLabel, [categoryLabel]);
      }
      for (const field of fields) {
        const [anchor, ...choices] = typeof field === "string" ? [field] : field;
        const aliases = [...choices.map(t), ...(optionChoices[tab]?.[anchor] ?? [])];
        add({ tab, anchor, sectionAnchor }, t(translationKey(anchor)), fieldPath, aliases);
      }
    }

    for (const section of opts.settingsRegistry.mirroredSections) {
      if (section.tabId !== tab) continue;
      for (const setting of section.settings) {
        add({ tab, anchor: `mirrored:${setting.id}` }, t(setting.labelKey), [categoryLabel]);
      }
    }

    if (tab === "appearance") {
      // Each house system and ayanamsha is findable by name; it lands on its dropdown.
      const zodiacPath = [categoryLabel, t("settings.zodiacAndHouses")];
      const zodiacSection = "section:settings.zodiacAndHouses";
      opts.houseSystem.available.forEach((house, index) => {
        add({ tab, anchor: "settings.houseSystem", sectionAnchor: zodiacSection },
          house.labelKey ? t(house.labelKey) : house.label, zodiacPath, [], index);
      });
      for (const choice of opts.ayanamsha.available) {
        add({ tab, anchor: "settings.ayanamsha", sectionAnchor: zodiacSection }, choice.label, zodiacPath, [], 1000 + choice.index);
      }
      for (const field of cat.sliders) {
        add({ tab, anchor: `slider:${field.attr}` }, field.label, [categoryLabel, t("settings.sizes")]);
      }
    }
    if (tab === "colors") {
      for (const field of cat.colorFields) {
        add({ tab, anchor: `color:${field.attr}` }, field.label, [categoryLabel, t(COLOR_GROUP_TITLE_KEYS[field.group])]);
      }
    }
    if (tab === "primarydirections") {
      for (const directionsTab of Object.keys(DIRECTIONS_TABS) as PrimaryDirectionsSettingsTab[]) {
        const subtabLabel = t(DIRECTIONS_TABS[directionsTab]);
        add({ tab, directionsTab }, subtabLabel, [categoryLabel]);
        for (const key of DIRECTIONS_FIELDS[directionsTab]) {
          add({ tab, directionsTab, anchor: key }, t(key), [categoryLabel, subtabLabel]);
        }
      }
      for (const key of PD_SYSTEM_LABEL_KEYS) {
        add({ tab, directionsTab: "calculation", anchor: key }, t(key), [
          categoryLabel, t(DIRECTIONS_TABS.calculation), t("primdir.houseSystem"),
        ]);
      }
    }
  }
  return entries;
}

export function searchSettings(index: SearchEntry[], query: string): SettingsSearchResult[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const words = normalized.split(" ");
  return index.flatMap(entry => {
    const { ownText } = entry;
    const allText = `${ownText} ${entry.pathText}`;
    // Breadcrumbs can qualify a result. At least one term must describe the
    // item itself so a category-name search doesn't return every field in it.
    if (!words.every(word => allText.includes(word)) || !words.some(word => ownText.includes(word))) return [];
    const score = entry.labelText === normalized ? 0
      : entry.names.includes(normalized) ? 1
      : entry.labelText.startsWith(normalized) ? 2
      : ownText.includes(normalized) ? 3 : 4;
    return [{ entry, score }];
  }).sort((a, b) => a.score - b.score).map(({ entry }) => entry);
}
