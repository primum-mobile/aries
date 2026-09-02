// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  buildTitleParts,
  graphicEphemerisModeButtonLabelKey,
  navigationHintGroups,
  shortcutTextForStep,
} from "../src/components/workshell/workspace-content";
import { radixOverlayTopLeftLines } from "../src/lib/chart/chart-overlay-lines";
import type { Chart, ChartRenderSnapshot } from "../src/lib/chart/types";
import { BUNDLES } from "../src/lib/i18n/messages";
import type { LocaleCode } from "../src/lib/i18n/langs";
import type { TFunc } from "../src/lib/i18n/i18n";
import type { WorkspaceDocument } from "../src/stores/workspace-store";

const baseContext = {
  chartVisualMode: "zodiac",
  launcherKind: null,
  compoundKind: null,
  kind: "radix" as const,
  supplementaryFeatureKind: null,
};

function translator(code: LocaleCode): TFunc {
  const messages = BUNDLES[code] ?? {};
  const english = BUNDLES.en ?? {};
  return (key, params) => {
    const message = messages[key] ?? english[key] ?? key;
    if (!params) return message;
    return message.replace(/\{(\w+)\}/g, (_, name: string) =>
      name in params ? String(params[name]) : `{${name}}`,
    );
  };
}

test("every chart-navbar navigation branch routes labels and tooltips through i18n", () => {
  const t: TFunc = (key, params) =>
    `⟦${key}${params?.unit ? `:${params.unit}` : ""}⟧`;
  const contexts = [
    { ...baseContext, launcherKind: "pd_in_chart" },
    { ...baseContext, chartVisualMode: "mdo" },
    baseContext,
    { ...baseContext, kind: "supplementary" as const, supplementaryFeatureKind: "secondary-progression" as const },
    { ...baseContext, kind: "supplementary" as const, supplementaryFeatureKind: "profections" as const },
    { ...baseContext, kind: "supplementary" as const, supplementaryFeatureKind: "solar-revolution" as const },
    { ...baseContext, kind: "supplementary" as const, supplementaryFeatureKind: "lunar-revolution" as const },
    { ...baseContext, kind: "supplementary" as const, supplementaryFeatureKind: "planetary-return" as const },
  ];

  const groups = contexts.flatMap((context) => navigationHintGroups(context, t));

  expect(groups).not.toHaveLength(0);
  for (const group of groups) {
    expect(group.label).toMatch(/^⟦toolbar\.navbar\.unit\./);
    expect(group.backwardLabel).toMatch(/^⟦toolbar\.navbar\.stepBackward:/);
    expect(group.forwardLabel).toMatch(/^⟦toolbar\.navbar\.stepForward:/);
  }
  expect(shortcutTextForStep("left", { alt: true })).toBe("⌥ + ←");
  expect(shortcutTextForStep("right", { shift: true })).toBe("⇧ + →");
});

test("chart-navbar labels render in every strict language", () => {
  const expected = {
    de: ["Minute", "Stunde", "Tag", "Zurück: Minute"],
    fr: ["minute", "heure", "jour", "Reculer : minute"],
    es: ["minuto", "hora", "día", "Retroceder: minuto"],
    it: ["minuto", "ora", "giorno", "Indietro: minuto"],
  } as const;

  for (const [code, values] of Object.entries(expected)) {
    const t = translator(code as keyof typeof expected);
    const groups = navigationHintGroups(baseContext, t);
    expect(groups.map((group) => group.label)).toEqual(values.slice(0, 3));
    expect(groups[0].backwardLabel).toBe(values[3]);
  }
});

test("Graphic Ephemeris shares the localized rail with month and year arrows", () => {
  const groups = navigationHintGroups(
    { ...baseContext, kind: "ephemeris" as const },
    translator("en"),
  );

  expect(groups.map((group) => ({
    label: group.label,
    backwardKey: group.backwardKey,
    forwardKey: group.forwardKey,
  }))).toEqual([
    { label: "month", backwardKey: "left", forwardKey: "right" },
    { label: "year", backwardKey: "down", forwardKey: "up" },
  ]);
  expect(shortcutTextForStep("down")).toBe("↓");
  expect(shortcutTextForStep("up")).toBe("↑");
  expect(translator("en")(graphicEphemerisModeButtonLabelKey("longitude"))).toBe("Lon/Decl");
  expect(translator("en")(graphicEphemerisModeButtonLabelKey("declination"))).toBe("Decl/Lon");
});

test("relationship charts replace time navigation with view controls", () => {
  expect(navigationHintGroups(
    { ...baseContext, kind: "supplementary", compoundKind: "synastry" },
    translator("en"),
  )).toEqual([]);
  expect(navigationHintGroups(
    { ...baseContext, kind: "supplementary", compoundKind: "composite_from_synastry" },
    translator("en"),
  )).toEqual([]);
});

test("the radix-name option moves the name from the titlebar above the birth date", () => {
  const radix = {
    meta: {
      name: "Ada",
      kind: "radix",
      dateDisplay: "1815.December.10",
      timeDisplay: "12:00:00, ZN",
      titleParts: ["Ada", "Radix", "2026.August.13", "Age: 210.68y"],
    },
    options: { showRadixNameInCanvas: true },
  } as unknown as Chart;
  const snapshot = { primaryChart: radix } as unknown as ChartRenderSnapshot;
  const document = {
    id: "radix-1",
    parentDocumentId: null,
    kind: "radix",
    sourceName: "Ada",
    title: "Ada",
  } as WorkspaceDocument;

  expect(radixOverlayTopLeftLines(radix)).toEqual([
    "Ada",
    "1815.December.10",
    "12:00:00, ZN",
  ]);
  expect(buildTitleParts(snapshot, document, translator("en"))).toEqual([
    "Radix",
    "2026.August.13",
    "Age: 210.68y",
  ]);
});

test("the radix-name option also moves a Here and Now horary name", () => {
  const horary = {
    meta: {
      name: "Here and Now",
      kind: "horary",
      dateDisplay: "13.August.2026",
      timeDisplay: "17:20:32, ZN",
    },
    options: { showRadixNameInCanvas: true },
  } as unknown as Chart;
  const snapshot = {
    primaryChart: horary,
    document: { titleSuffix: "Horary • Thu 13.08.2026 17:20" },
  } as unknown as ChartRenderSnapshot;
  const document = {
    id: "here-now-1",
    parentDocumentId: null,
    kind: "here-now",
    sourceName: "Here and Now",
    title: "Here and Now",
    isHorary: true,
  } as WorkspaceDocument;

  expect(radixOverlayTopLeftLines(horary)).toEqual([
    "Here and Now",
    "13.August.2026",
    "17:20:32, ZN",
  ]);
  expect(buildTitleParts(snapshot, document, translator("en"))).toEqual([
    "Horary • Thu 13.08.2026 17:20",
  ]);
});

test("every derived child inherits the root radix name in its canvas overlay", () => {
  const radix = {
    meta: { name: "Ada" },
  } as unknown as Chart;
  const derivedKinds: Chart["meta"]["kind"][] = [
    "transit",
    "solar-return",
    "lunar-return",
    "progression",
    "revolution",
    "profection",
    "primary-direction",
  ];

  for (const kind of derivedKinds) {
    const child = {
      meta: {
        name: "Derived display name",
        kind,
        dateDisplay: "13.August.2026",
        timeDisplay: "17:20:32, ZN",
      },
      options: { showRadixNameInCanvas: true },
    } as unknown as Chart;

    expect(radixOverlayTopLeftLines(child, radix)).toEqual([
      "Ada",
      "13.August.2026",
      "17:20:32, ZN",
    ]);
  }
});
