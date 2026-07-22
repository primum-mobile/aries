import { expect, test } from "@playwright/test";

import {
  navigationHintGroups,
  shortcutTextForStep,
} from "../src/components/workshell/workspace-content";
import { BUNDLES } from "../src/lib/i18n/messages";
import type { LocaleCode } from "../src/lib/i18n/langs";
import type { TFunc } from "../src/lib/i18n/i18n";

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
