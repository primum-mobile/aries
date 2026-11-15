// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import dynamic from "next/dynamic";

import { Dialog, FloatingDialogContent } from "@/components/ui/dialog";
import { useBrowserChartPickerStore } from "@/stores/browser-chart-picker-store";

const SystemChartPicker = dynamic(
  () => import("./system-chart-picker").then((mod) => mod.SystemChartPicker),
  { ssr: false },
);

/** The chart picker as a modeless floating panel for browser hosts. */
export function BrowserChartPicker() {
  const request = useBrowserChartPickerStore((state) => state.request);
  const closePicker = useBrowserChartPickerStore((state) => state.closePicker);
  if (!request) return null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) closePicker(); }} modal={false} disablePointerDismissal>
      <FloatingDialogContent
        size="lg"
        motion="none"
        showCloseButton={false}
        aria-label={request.title}
        data-aries-surface="popover"
        className="h-[min(var(--aries-dialog-viewport-height),var(--aries-dialog-content-height-workspace))] gap-0 overflow-hidden rounded-[var(--aries-radius-popover)] bg-[var(--aries-popover-background)] p-0"
      >
        <SystemChartPicker
          key={request.generation}
          mode={request.mode}
          parentRadixId={request.parentRadixId ?? null}
          excludeNames={request.excludeNames}
          embedded
          onCancel={closePicker}
        />
      </FloatingDialogContent>
    </Dialog>
  );
}
