// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ReactElement } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { patchOptions, type InspectorSpeculumPrecision, type OptionsPatch, type ThemeState } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { useThemeStore } from "@/stores/theme-store";

export function useTablePrecision() {
  return useThemeStore((state) => state.theme?.inspectorSpeculumPrecision ?? "seconds");
}

// Serialize display writes across surfaces. A late response to an earlier
// choice must never replace the more recent optimistic preference.
let displaySave = Promise.resolve();
let displayRevision = 0;

export function saveTableDisplay(
  display: NonNullable<OptionsPatch["display"]>,
  optimistic: Pick<ThemeState, "inspectorTextSize" | "inspectorSpeculumPrecision">,
) {
  const revision = ++displayRevision;
  const theme = useThemeStore.getState().theme;
  if (theme) useThemeStore.getState().applyThemeState({ ...theme, ...optimistic });
  displaySave = displaySave.catch(() => undefined).then(async () => {
    try {
      const next = await patchOptions({ display });
      if (revision === displayRevision) useThemeStore.getState().applyThemeState(next.themeState);
    } catch (error) {
      console.error("[table-display]", error);
      if (revision === displayRevision) await useThemeStore.getState().fetchThemeState();
    }
  });
}

export function TablePrecisionChoices() {
  const t = useT();
  const current = useTablePrecision();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{t("inspector.speculumPrecision.label")}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup value={current} onValueChange={(value) => {
          if (value === current) return;
          const precision = value as InspectorSpeculumPrecision;
          // Keep the persisted key so existing Inspector choices carry forward.
          saveTableDisplay({ inspector_speculum_precision: precision }, { inspectorSpeculumPrecision: precision });
        }}>
          <ContextMenuRadioItem value="degrees">{t("inspector.speculumPrecision.degrees")}</ContextMenuRadioItem>
          <ContextMenuRadioItem value="minutes">{t("inspector.speculumPrecision.minutes")}</ContextMenuRadioItem>
          <ContextMenuRadioItem value="seconds">{t("inspector.speculumPrecision.seconds")}</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function TablePrecisionMenu({ children }: { children: ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent><TablePrecisionChoices /></ContextMenuContent>
    </ContextMenu>
  );
}
