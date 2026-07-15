// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/i18n";
import { LIST_BUTTON_PROPS, LIST_PANE_CLASSES } from "@/lib/list-tokens";

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
    <section className={LIST_PANE_CLASSES.root} aria-label={t("featureCatalog.title")}>
      <header className={LIST_PANE_CLASSES.compactHeader}>
        <h1 className={LIST_PANE_CLASSES.title}>{t("featureCatalog.title")}</h1>
        <Button
          type="button"
          {...LIST_BUTTON_PROPS.icon}
          onClick={onClose}
          aria-label={t("featureCatalog.close")}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </header>

      <div className={`${LIST_PANE_CLASSES.scroller} px-4 py-3`}>
        <div className="space-y-5 pb-4">
          {FEATURE_GROUPS.map((group) => (
            <section key={group.titleKey} className="space-y-1.5">
              <h2 className="text-[12px] font-semibold text-foreground">
                {t(group.titleKey)}
              </h2>
              <ul className="space-y-0.5 pl-4 text-[12px] leading-5 text-muted-foreground">
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
    </section>
  );
}
