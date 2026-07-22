// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useT } from "@/lib/i18n/i18n";
import { LIST_PANE_CLASSES } from "@/lib/list-tokens";

import { RetainedPaneShell } from "./retained-pane-shell";

export function WhatsNewView({
  version,
  notes,
  onClose,
}: {
  version: string;
  notes: string;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <RetainedPaneShell
      title={t("license.whatsNewTitle")}
      subtitle={t("license.whatsNewVersion", { version })}
      closeLabel={t("license.whatsNewClose")}
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
        <div className="whitespace-pre-wrap break-words pb-[var(--aries-pane-content-padding)] text-[length:var(--aries-font-size-small)] leading-[var(--aries-font-line-height-reading)] text-muted-foreground">
          {notes || t("license.whatsNewEmpty")}
        </div>
      </div>
    </RetainedPaneShell>
  );
}
