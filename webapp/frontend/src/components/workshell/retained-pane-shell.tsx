// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

type RetainedPaneShellProps = {
  title: string;
  sourceName?: string;
  subtitle?: React.ReactNode;
  closeLabel: string;
  onClose?: () => void;
  toolbar?: React.ReactNode;
  wrapHeader?: boolean;
  closeSize?: "compact" | "small";
  closeAppearance?: "pane" | "list";
  closePosition?: "leading" | "trailing";
  titleSize?: "small" | "large";
  titleWeight?: "medium" | "semibold";
  subtitleSize?: "section" | "small";
  headerDensity?: "standard" | "compact";
  headerSurface?: "background" | "surface";
  sourceGap?: "compact" | "standard";
  children: React.ReactNode;
};

export function RetainedPaneShell({
  title,
  sourceName,
  subtitle,
  closeLabel,
  onClose,
  toolbar,
  wrapHeader = false,
  closeSize = "compact",
  closeAppearance = "pane",
  closePosition = "trailing",
  titleSize = "small",
  titleWeight = "medium",
  subtitleSize = "section",
  headerDensity = "standard",
  headerSurface = "background",
  sourceGap = "compact",
  children,
}: RetainedPaneShellProps) {
  const closeButton = onClose ? (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-[color:var(--aries-text-primary)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
        closeAppearance === "list"
          ? "rounded-[var(--aries-radius-ui-control-compact)] border border-transparent bg-clip-padding transition-all outline-none select-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px dark:hover:bg-muted/50"
          : "rounded-[var(--aries-radius-control-compact)] hover:bg-accent/40",
        closeSize === "small"
          ? "size-[var(--aries-control-height-small)]"
          : "size-[var(--aries-control-height-compact)]",
      )}
      onClick={onClose}
      aria-label={closeLabel}
    >
      <X
        className={cn(
          closeAppearance === "list"
            ? "size-[var(--aries-control-icon-size)]"
            : "size-[var(--aries-control-icon-size-default)]",
        )}
      />
    </button>
  ) : null;

  return (
    <section
      className="font-morinus-text flex h-full min-h-0 flex-col bg-background"
      aria-label={title}
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-[color:var(--aries-border-subtle)]",
          headerDensity === "compact"
            ? "gap-x-[var(--aries-pane-control-compact-gap-x)] gap-y-[var(--aries-pane-control-gap-y)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-compact-padding-y)]"
            : "gap-[var(--aries-pane-control-gap-y)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)]",
          headerSurface === "surface"
            ? "bg-[color:var(--aries-surface)]"
            : "bg-background",
          wrapHeader && "flex-wrap",
        )}
      >
        <div className="flex min-w-0 items-center gap-[var(--aries-control-gap)]">
          {closePosition === "leading" ? closeButton : null}
          <div className="min-w-0">
            <div
              className={cn(
                "truncate font-medium text-[color:var(--aries-text-primary)]",
                titleSize === "large"
                  ? "text-[length:var(--aries-font-size-large)]"
                  : "text-[length:var(--aries-font-size-small)]",
                titleWeight === "semibold" ? "font-semibold" : "font-medium",
              )}
            >
              {title}
              {sourceName ? (
                <span
                  className={cn(
                    "font-normal text-[color:var(--aries-text-muted)]",
                    sourceGap === "standard"
                      ? "ml-[var(--aries-pane-control-gap-y)]"
                      : "ml-[var(--aries-control-gap-compact)]",
                  )}
                >
                  {sourceName}
                </span>
              ) : null}
            </div>
            {subtitle ? (
              <div
                className={cn(
                  "truncate text-[color:var(--aries-text-muted)]",
                  subtitleSize === "small"
                    ? "text-[length:var(--aries-font-size-small)]"
                    : "text-[length:var(--aries-font-size-section)]",
                )}
              >
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
        <div
          className={cn(
            "ml-auto flex items-center gap-[var(--aries-control-gap-compact)]",
            wrapHeader && "flex-wrap justify-end",
          )}
        >
          {toolbar}
          {closePosition === "trailing" ? closeButton : null}
        </div>
      </div>
      {children}
    </section>
  );
}
