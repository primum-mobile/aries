// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";

type ChartCopyControlProps = {
  enabled: boolean;
  onCopy?: () => void | Promise<boolean>;
  children: React.ReactNode;
};

export function ChartCopyControl({
  enabled,
  onCopy,
  children,
}: ChartCopyControlProps) {
  const t = useT();
  const [phase, setPhase] = React.useState<"idle" | "confirmed" | "done">("idle");
  const timerRef = React.useRef<number | null>(null);
  const resetAfterRef = React.useRef(0);

  React.useEffect(() => () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  if (!enabled || !onCopy) {
    return (
      <div
        data-tauri-drag-region
        data-aries-titlebar-title=""
        className="flex min-w-0 max-w-full items-center justify-center"
      >
        {children}
      </div>
    );
  }

  const handleCopy = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    setPhase("confirmed");
    resetAfterRef.current = window.performance.now() + 1350;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setPhase("done");
    }, 1100);
    queueMicrotask(() => {
      void onCopy();
    });
  };

  return (
    <button
      type="button"
      aria-label={t("nativeMenu.copyChartAsPng")}
      title={t("nativeMenu.copyChartAsPng")}
      data-aries-titlebar-title=""
      data-chart-copy-feedback={phase}
      onPointerEnter={() => {
        if (phase === "done" && window.performance.now() >= resetAfterRef.current) {
          setPhase("idle");
        }
      }}
      onClick={handleCopy}
      className={cn(
        "group flex min-w-0 max-w-full items-center justify-center gap-[0.3em] rounded-[0.3em] text-[color:var(--aries-titlebar-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {children}
      <span
        className={cn(
          "flex h-[1lh] w-[1lh] shrink-0 items-center justify-center text-[color:var(--aries-titlebar-icon)] transition-[opacity,color] duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)]",
          phase === "idle"
            ? "opacity-0 group-hover:text-[color:var(--aries-titlebar-icon-hover)] group-hover:opacity-100 group-focus-visible:opacity-100"
            : phase === "confirmed"
              ? "text-[color:var(--aries-titlebar-icon-hover)] opacity-100"
              : "opacity-0",
        )}
      >
        {phase === "idle" ? (
          <Copy className="size-[0.9em]" strokeWidth={1.5} />
        ) : (
          <Check className="size-[0.9em]" strokeWidth={1.5} />
        )}
      </span>
    </button>
  );
}
