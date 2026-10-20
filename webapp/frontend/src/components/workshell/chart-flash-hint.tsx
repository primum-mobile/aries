// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { useT } from "@/lib/i18n/i18n";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function ChartFlashHint() {
  const t = useT();
  const hint = useWorkspaceStore((state) => state.chartFlashHint);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!hint) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const fadeTimer = window.setTimeout(() => setVisible(false), 900);
    return () => window.clearTimeout(fadeTimer);
  }, [hint?.nonce]);

  if (!hint) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-[10%] z-[60] flex justify-center px-[var(--aries-pane-header-padding-x)]"
      aria-live="polite"
    >
      <div
        key={hint.nonce}
        className={`max-w-[min(100%,28rem)] rounded-[var(--aries-radius-popover)] bg-[var(--aries-popover-background)]/95 px-[var(--aries-control-padding-x)] py-[var(--aries-control-padding-y)] text-center text-[length:var(--aries-font-size-small)] text-[color:var(--aries-popover-text)] shadow-md ring-1 ring-foreground/10 transition-opacity duration-500 ease-out ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {t(hint.messageKey)}
      </div>
    </div>
  );
}
