// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  resolveStyleTokenValues,
  STYLE_TOKEN_GROUPS,
  STYLE_TOKENS,
  type ColorStyleToken,
  type FontStyleToken,
  type NumberStyleToken,
  type StyleToken,
} from "@/styles/style-tokens";
import { useStyleStore } from "@/stores/style-store";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AppearancePanel({ open, onOpenChange }: Props) {
  const t = useT();
  const values = useStyleStore((state) => state.values);
  const setToken = useStyleStore((state) => state.setToken);
  const resetToken = useStyleStore((state) => state.resetToken);
  const resetAll = useStyleStore((state) => state.resetAll);
  const resolved = React.useMemo(() => resolveStyleTokenValues(values), [values]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="md"
        className="gap-0 border-border bg-popover"
      >
        <SheetHeader className="px-[var(--aries-panel-padding-x)] py-[var(--aries-panel-padding-y)]">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div>
              <SheetTitle className="text-[length:var(--aries-font-size-header)]">
                {t("appearance.title")}
              </SheetTitle>
              <SheetDescription className="text-[length:var(--aries-font-size-small)]">
                {t("appearance.description")}
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[length:var(--aries-font-size-small)]"
              onClick={resetAll}
            >
              <RotateCcw className="size-3.5" />
              {t("appearance.reset")}
            </Button>
          </div>
        </SheetHeader>
        <Separator />
        <div className="min-h-0 flex-1 overflow-y-auto px-[var(--aries-panel-padding-x)] py-[var(--aries-panel-padding-y)]">
          <div className="grid gap-[var(--aries-section-gap)]">
            {STYLE_TOKEN_GROUPS.map((group) => {
              const groupTokens = STYLE_TOKENS.filter((token) => token.group === group);
              return (
                <section key={group} className="grid gap-2">
                  <h3 className="text-[length:var(--aries-font-size-section)] font-normal tracking-normal text-[color:var(--aries-text-dim)]">
                    {group}
                  </h3>
                  <div className="grid gap-2">
                    {groupTokens.map((token) => (
                      <TokenControl
                        key={token.id}
                        token={token}
                        value={resolved[token.id]}
                        customized={values[token.id] !== undefined}
                        onChange={(value) => setToken(token.id, value)}
                        onReset={() => resetToken(token.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TokenControl({
  token,
  value,
  customized,
  onChange,
  onReset,
}: {
  token: StyleToken;
  value: string | number;
  customized: boolean;
  onChange: (value: string | number) => void;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-1 rounded-md border border-border/80 bg-card/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={`appearance-${token.id}`}
          className="text-[length:var(--aries-font-size-base)] text-[color:var(--aries-text-primary)]"
        >
          {token.label}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!customized}
          className={cn("h-6 w-6", !customized && "opacity-30")}
          onClick={onReset}
          aria-label={t("appearance.resetToken", { label: token.label })}
        >
          <RotateCcw className="size-3" />
        </Button>
      </div>
      {token.kind === "font" ? (
        <FontControl token={token} value={String(value)} onChange={onChange} />
      ) : token.kind === "color" ? (
        <ColorControl token={token} value={String(value)} onChange={onChange} />
      ) : (
        <NumberControl token={token} value={Number(value)} onChange={onChange} />
      )}
    </div>
  );
}

function FontControl({
  token,
  value,
  onChange,
}: {
  token: FontStyleToken;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      data-aries-control-appearance="local"
      id={`appearance-${token.id}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-[var(--aries-control-height)] rounded-[var(--aries-radius-ui-control-compact)] border border-input bg-background px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-base)] text-foreground outline-none focus-visible:border-ring"
    >
      {token.options.map((option) => (
        <option key={option.label} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function NumberControl({
  token,
  value,
  onChange,
}: {
  token: NumberStyleToken;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_3.5rem] items-center gap-2">
      <input
        id={`appearance-${token.id}`}
        type="range"
        min={token.min}
        max={token.max}
        step={token.step}
        value={Number.isFinite(value) ? value : Number(token.defaultValue)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full [accent-color:var(--aries-text-primary)]"
      />
      <output className="text-right text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
        {formatNumber(value)}
        {token.unit}
      </output>
    </div>
  );
}

function ColorControl({
  token,
  value,
  onChange,
}: {
  token: ColorStyleToken;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const hex = normalizeColor(value, token.defaultValue);
  return (
    <div className="grid grid-cols-[2.75rem_1fr] items-center gap-2">
      <input
        id={`appearance-${token.id}`}
        type="color"
        value={hex}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-11 rounded border border-input bg-transparent p-0.5"
      />
      <input
        data-aries-control-appearance="local"
        value={hex}
        onChange={(event) => onChange(normalizeColor(event.target.value, hex))}
        className="h-[var(--aries-control-height)] rounded-[var(--aries-radius-ui-control-compact)] border border-input bg-background px-[var(--aries-control-padding-x-compact)] font-mono text-[length:var(--aries-font-size-small)] text-foreground outline-none focus-visible:border-ring"
        aria-label={t("appearance.hexValue", { label: token.label })}
      />
    </div>
  );
}

function normalizeColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return fallback;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
