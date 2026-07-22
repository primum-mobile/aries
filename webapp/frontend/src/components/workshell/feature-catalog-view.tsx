// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useT } from "@/lib/i18n/i18n";
import { LIST_PANE_CLASSES } from "@/lib/list-tokens";

import { RetainedPaneShell } from "./retained-pane-shell";

type FeatureGroup = {
  titleKey: string;
  itemsKey: string;
};

// Concise community-facing catalogue. Each translated section is newline-
// separated so the supplied wording and order remain a single editorial unit.
const FEATURE_GROUPS: readonly FeatureGroup[] = [
  {
    titleKey: "featureCatalog.group.hellenistic",
    itemsKey: "featureCatalog.list.hellenistic",
  },
  {
    titleKey: "featureCatalog.group.medieval",
    itemsKey: "featureCatalog.list.medieval",
  },
  {
    titleKey: "featureCatalog.group.primaryDirections",
    itemsKey: "featureCatalog.list.primaryDirections",
  },
  {
    titleKey: "featureCatalog.group.timedCharts",
    itemsKey: "featureCatalog.list.timedCharts",
  },
  {
    titleKey: "featureCatalog.group.revolutions",
    itemsKey: "featureCatalog.list.revolutions",
  },
  {
    titleKey: "featureCatalog.group.relationship",
    itemsKey: "featureCatalog.list.relationship",
  },
  {
    titleKey: "featureCatalog.group.horaryElectional",
    itemsKey: "featureCatalog.list.horary",
  },
  {
    titleKey: "featureCatalog.group.mundaneLocational",
    itemsKey: "featureCatalog.list.locational",
  },
  {
    titleKey: "featureCatalog.group.starsCycles",
    itemsKey: "featureCatalog.list.starsCycles",
  },
  {
    titleKey: "featureCatalog.group.natal",
    itemsKey: "featureCatalog.list.natal",
  },
  {
    titleKey: "featureCatalog.group.tables",
    itemsKey: "featureCatalog.list.tables",
  },
] as const;

export function FeatureCatalogView({ onClose }: { onClose: () => void }) {
  const t = useT();

  return (
    <RetainedPaneShell
      title={t("featureCatalog.title")}
      closeLabel={t("featureCatalog.close")}
      onClose={onClose}
      closeAppearance="list"
      wrapHeader
      titleSize="large"
      titleWeight="semibold"
      headerDensity="compact"
    >
      <div
        className={`${LIST_PANE_CLASSES.scroller} px-[var(--aries-panel-padding-x)] py-[var(--aries-panel-padding-y)]`}
      >
        <div className="space-y-[var(--aries-form-section-gap)] pb-[var(--aries-pane-content-padding)]">
          {FEATURE_GROUPS.map((group) => (
            <section key={group.titleKey} className="space-y-[var(--aries-control-gap)]">
              <h2 className="text-[length:var(--aries-font-size-base)] font-semibold text-foreground">
                {t(group.titleKey)}
              </h2>
              <ul className="space-y-[calc(var(--aries-control-gap)/3)] pl-[var(--aries-pane-content-padding)] text-[length:var(--aries-font-size-base)] leading-[var(--aries-font-line-height-reading)] text-muted-foreground">
                {t(group.itemsKey).split("\n").filter(Boolean).map((item) => (
                  <li key={item} className="list-disc">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </RetainedPaneShell>
  );
}
