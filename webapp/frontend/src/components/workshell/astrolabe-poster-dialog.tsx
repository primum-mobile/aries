// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Poster export dialog (⌥E): a fixed layout (Layouts tab) or what the sheet
// carries (Custom tab), beside a schematic of the portrait sheet drawn from
// the same layout the export paints, so every choice shows where things go.

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PosterSheet } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  POSTER_CONTENT_K,
  POSTER_LEAD_SHARE_RANGE,
  type PosterContent,
  type PosterLayout,
} from "./astrolabe-poster";

/** The sheet's elements and its paper. The wheel and the plate themselves
 * are what the screen shows (style, aspects, house lines, layers). */
export type PosterChoice = PosterContent & {
  sheet: PosterSheet;
  kind: "pdf" | "png";
  /** A fixed layout, or the Custom tab's elements. */
  mode: "layout" | "custom";
  layoutId: PosterLayoutId;
};

/** The fixed layouts. */
export type PosterLayoutId = "stagger";

/** What could not be prepared for the export. */
export type PosterFailure = "modules" | "plate";

export const POSTER_CHOICE_DEFAULT: PosterChoice = {
  ...POSTER_CONTENT_K,
  sheet: "A1",
  kind: "pdf",
  mode: "layout",
  layoutId: "stagger",
};

/** What the sheet can carry: without a chart only the plate and the paper
 * remain, and the fixed layouts need one. */
export function effectivePosterChoice(choice: PosterChoice, hasChart: boolean): PosterChoice {
  return hasChart ? choice : {
    ...choice, mode: "custom", wheel: false, speculum: false, cusps: false, aspectGrid: false, declination: false, moon: false, facts: false,
  };
}

/** Something to print: a fixed layout, or at least one element besides the frame and margin. */
export function posterHasContent(choice: PosterChoice): boolean {
  return choice.mode === "layout" || choice.plate || choice.wheel || choice.speculum || choice.cusps
    || choice.aspectGrid || choice.declination || choice.moon;
}

const SHEETS: readonly PosterSheet[] = ["A1", "A2", "A3"];

const FIELD = "flex flex-col gap-[var(--aries-control-gap-compact)]";
const CAPTION = "text-[color:var(--aries-text-muted)]";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={FIELD}>
      <span className={CAPTION}>{label}</span>
      <div role="radiogroup" aria-label={label} className={cn("flex rounded-[var(--aries-radius-control-compact)] ring-1 ring-[color:var(--aries-border-subtle)]", disabled && "opacity-50")}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 px-[var(--aries-control-padding-x-compact)] py-[var(--aries-control-gap)] first:rounded-l-[var(--aries-radius-control-compact)] last:rounded-r-[var(--aries-radius-control-compact)]",
              option.value === value
                ? "bg-[color:var(--aries-accent)] text-[color:var(--aries-accent-foreground)]"
                : "hover:bg-[color:var(--aries-surface-subtle)]",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex min-h-6 items-center gap-2", disabled && "opacity-50")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-[color:var(--aries-accent)]"
      />
      <span>{label}</span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col">
      <legend className={cn(CAPTION, "pb-[var(--aries-control-gap-compact)]")}>{title}</legend>
      {children}
    </fieldset>
  );
}

/** The sheet in outline: every element where the export will paint it. */
function PosterSchematic({ layout, label }: { layout: PosterLayout; label: string }) {
  const { page, frame, foot, content } = layout;
  const ink = "var(--aries-text-muted)";
  const fill = "var(--aries-surface-subtle)";
  const line = { stroke: ink, strokeWidth: 3, fill: "none" } as const;
  const hair = { stroke: ink, strokeWidth: 1.5, fill: "none", opacity: 0.6 } as const;
  const disc = (cx: number, cy: number, r: number, kind: "plate" | "wheel") => (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={ink} strokeWidth={4} />
      {kind === "plate" ? (
        <>
          <circle cx={cx} cy={cy} r={r * 0.62} {...hair} />
          <circle cx={cx} cy={cy - r * 0.18} r={r * 0.5} {...hair} />
          <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} {...hair} />
          <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} {...hair} />
        </>
      ) : (
        <>
          <circle cx={cx} cy={cy} r={r * 0.82} {...hair} />
          <circle cx={cx} cy={cy} r={r * 0.5} {...hair} />
          {Array.from({ length: 12 }, (_, index) => {
            const a = (index * Math.PI) / 6;
            return (
              <line
                key={index}
                x1={cx + Math.cos(a) * r * 0.5}
                y1={cy + Math.sin(a) * r * 0.5}
                x2={cx + Math.cos(a) * r * 0.82}
                y2={cy + Math.sin(a) * r * 0.82}
                {...hair}
              />
            );
          })}
        </>
      )}
    </g>
  );
  const rows = (x: number, y: number, w: number, h: number, count: number) => (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} stroke="none" />
      {Array.from({ length: count }, (_, index) => {
        const ry = y + ((index + 0.5) * h) / count;
        return <line key={index} x1={x + w * 0.06} y1={ry} x2={x + w * (index === 0 ? 0.55 : 0.94)} y2={ry} {...hair} />;
      })}
    </g>
  );
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${page.width} ${page.height}`}
      className="h-full w-auto max-w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={page.width} height={page.height} fill="var(--aries-surface)" stroke={ink} strokeWidth={4} />
      {content.neatline ? (
        <>
          <rect x={frame} y={frame} width={page.width - frame * 2} height={page.height - frame * 2} {...line} />
          <rect x={frame + 8} y={frame + 8} width={page.width - frame * 2 - 16} height={page.height - frame * 2 - 16} {...hair} />
        </>
      ) : null}
      {content.facts ? (
        <g fill={ink} opacity={0.8}>
          <rect x={page.width / 2 - 110} y={frame / 2 - foot * 0.6} width={220} height={foot * 1.2} rx={foot * 0.3} />
          <rect x={page.width / 2 - 260} y={page.height - frame / 2 - foot * 0.45} width={520} height={foot * 0.9} rx={foot * 0.3} opacity={0.7} />
          <rect x={frame / 2 - foot * 0.45} y={page.height / 2 - 70} width={foot * 0.9} height={140} rx={foot * 0.3} opacity={0.7} />
          <rect x={page.width - frame / 2 - foot * 0.45} y={page.height / 2 - 70} width={foot * 0.9} height={140} rx={foot * 0.3} opacity={0.7} />
        </g>
      ) : null}
      {layout.boxes.map(({ id, rect }) => {
        const { x, y, w, h } = rect;
        switch (id) {
          case "plate":
          case "wheel":
            return <g key={id}>{disc(x + w / 2, y + h / 2, w / 2, id)}</g>;
          case "speculum":
            return <g key={id}>{rows(x, y, w, h, 14)}</g>;
          case "cusps":
            return <g key={id}>{rows(x, y, w, h, 13)}</g>;
          case "aspectGrid": {
            const steps = 8;
            const cell = w / steps;
            const points = [`${x},${y}`];
            for (let i = 1; i <= steps; i++) points.push(`${x + cell * i},${y + cell * (i - 1)}`, `${x + cell * i},${y + cell * i}`);
            points.push(`${x},${y + h}`);
            return <polygon key={id} points={points.join(" ")} fill={fill} stroke={ink} strokeWidth={3} />;
          }
          case "declination":
            return (
              <g key={id}>
                <rect x={x} y={y} width={w} height={h} fill={fill} stroke="none" />
                <line x1={x} y1={y + h * 0.7} x2={x + w} y2={y + h * 0.7} {...line} />
                {Array.from({ length: 9 }, (_, index) => (
                  <line key={index} x1={x + (w * index) / 8} y1={y + h * 0.62} x2={x + (w * index) / 8} y2={y + h * 0.78} {...hair} />
                ))}
              </g>
            );
          case "moon":
            return <g key={id}>{rows(x, y, w, h, 7)}</g>;
          case "ledger":
            return (
              <g key={id}>
                {rows(x, y, w * 0.52, h, 15)}
                {rows(x + w * 0.6, y, w * 0.4, h, 15)}
              </g>
            );
          case "title": {
            // The name, then the facts lines under it.
            const facts = 5;
            const nameH = h * 0.22;
            const step = (h - nameH * 1.6) / facts;
            return (
              <g key={id} fill={ink}>
                <rect x={x} y={y} width={w * 0.8} height={nameH} rx={nameH * 0.2} />
                {Array.from({ length: facts }, (_, index) => (
                  <rect key={index} x={x} y={y + nameH * 1.6 + step * index} width={w * (index < 2 ? 0.6 : 0.85)} height={step * 0.55} rx={step * 0.2} opacity={index < 2 ? 0.8 : 0.55} />
                ))}
              </g>
            );
          }
          default:
            return null;
        }
      })}
    </svg>
  );
}

export function AstrolabePosterDialog({
  open,
  onOpenChange,
  choice,
  onChoiceChange,
  layoutFor,
  hasChart,
  busy,
  failure,
  onExport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choice: PosterChoice;
  onChoiceChange: (next: PosterChoice) => void;
  /** The sheet the export would paint for a choice (the host knows the chart, its type and modules). */
  layoutFor: (choice: PosterChoice) => PosterLayout;
  /** A chart of the astrolabe's moment exists (wheel, tables, modules and the fixed layouts need one). */
  hasChart: boolean;
  busy: boolean;
  /** What the last export could not prepare. */
  failure?: PosterFailure | null;
  onExport: () => void;
}) {
  const t = useT();
  const set = <K extends keyof PosterChoice>(key: K, value: PosterChoice[K]) => onChoiceChange({ ...choice, [key]: value });
  const effective = React.useMemo(() => effectivePosterChoice(choice, hasChart), [choice, hasChart]);
  // The layout solves the sheet several times; the sketch recomputes only
  // when a choice or the host's inputs change.
  const layout = React.useMemo(() => layoutFor(effective), [effective, layoutFor]);
  const both = effective.plate && effective.wheel;
  const [minShare, maxShare] = POSTER_LEAD_SHARE_RANGE;
  const canExport = posterHasContent(effective) && !busy;
  const layouts: ReadonlyArray<{ id: PosterLayoutId; label: string; hint: string }> = [
    { id: "stagger", label: t("astrolabe.poster.layoutStagger"), hint: t("astrolabe.poster.layoutStaggerHint") },
  ];
  const paper = (
    <div className="grid grid-cols-2 gap-[var(--aries-form-row-gap)]">
      <Segmented
        label={t("settings.pngFormat")}
        value={choice.kind}
        options={[
          { value: "pdf", label: t("astrolabe.poster.formatPdf") },
          { value: "png", label: t("astrolabe.poster.formatPng") },
        ]}
        onChange={(value) => set("kind", value)}
      />
      <Segmented
        label={t("astrolabe.poster.sheet")}
        value={choice.sheet}
        options={SHEETS.map((sheet) => ({ value: sheet, label: sheet }))}
        onChange={(value) => set("sheet", value)}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t("astrolabe.poster.saveTitle")}</DialogTitle>
          <DialogDescription>{t("astrolabe.poster.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-[var(--aries-dialog-gap)] text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]">
          <Tabs
            value={effective.mode}
            onValueChange={(value) => set("mode", value as PosterChoice["mode"])}
            className="flex min-w-0 flex-col gap-[var(--aries-form-row-gap)]"
          >
            <TabsList className="w-full" aria-label={t("astrolabe.poster.saveTitle")}>
              <TabsTrigger value="layout" disabled={!hasChart} className="text-[length:var(--aries-font-size-small)]">
                {t("astrolabe.poster.tabLayouts")}
              </TabsTrigger>
              <TabsTrigger value="custom" className="text-[length:var(--aries-font-size-small)]">
                {t("astrolabe.poster.tabCustom")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="layout" keepMounted className="flex flex-col gap-[var(--aries-form-row-gap)] data-[hidden]:hidden">
              {paper}
              <div role="radiogroup" aria-label={t("astrolabe.poster.tabLayouts")} className="flex flex-col gap-[var(--aries-control-gap-compact)]">
                {layouts.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={choice.layoutId === entry.id}
                    onClick={() => set("layoutId", entry.id)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-[var(--aries-radius-control-compact)] px-[var(--aries-control-padding-x-compact)] py-[var(--aries-control-gap)] text-left ring-1",
                      choice.layoutId === entry.id
                        ? "ring-[color:var(--aries-accent)]"
                        : "ring-[color:var(--aries-border-subtle)] hover:bg-[color:var(--aries-surface-subtle)]",
                    )}
                  >
                    <span className="font-medium">{entry.label}</span>
                    <span className={CAPTION}>{entry.hint}</span>
                  </button>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="custom" keepMounted className="flex flex-col gap-[var(--aries-form-row-gap)] data-[hidden]:hidden">
              {paper}
              <div className="grid grid-cols-2 gap-[var(--aries-form-row-gap)]">
                <Segmented
                  label={t("astrolabe.poster.lead")}
                  value={choice.lead}
                  disabled={!both}
                  options={[
                    { value: "astrolabe", label: t("astrolabe.poster.leadAstrolabe") },
                    { value: "chart", label: t("astrolabe.poster.leadChart") },
                  ]}
                  onChange={(value) => set("lead", value)}
                />
                <label className={cn(FIELD, !both && "opacity-50")}>
                  <span className="flex justify-between">
                    <span className={CAPTION}>{t("astrolabe.poster.leadSize")}</span>
                    <span className="tabular-nums">{`${Math.round(choice.leadShare * 100)}%`}</span>
                  </span>
                  <input
                    type="range"
                    min={minShare}
                    max={maxShare}
                    step={0.01}
                    disabled={!both}
                    value={choice.leadShare}
                    onChange={(event) => set("leadShare", Number(event.target.value))}
                    onDoubleClick={() => set("leadShare", POSTER_CONTENT_K.leadShare)}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-x-[var(--aries-dialog-gap)] gap-y-[var(--aries-form-row-gap)]">
                <Group title={t("astrolabe.poster.groupElements")}>
                  <Check label={t("astrolabe.poster.plate")} checked={choice.plate} onChange={(value) => set("plate", value)} />
                  <Check label={t("styleLab.scene.wheel")} checked={choice.wheel} disabled={!hasChart} onChange={(value) => set("wheel", value)} />
                  <Check label={t("astrolabe.poster.speculum")} checked={choice.speculum} disabled={!hasChart} onChange={(value) => set("speculum", value)} />
                  <Check label={t("astrolabe.poster.houseCusps")} checked={choice.cusps} disabled={!hasChart} onChange={(value) => set("cusps", value)} />
                </Group>
                <div className="flex flex-col gap-[var(--aries-form-row-gap)]">
                  <Group title={t("astrolabe.poster.groupDashboard")}>
                    <Check label={t("settings.dashboard.aspectGrid")} checked={choice.aspectGrid} disabled={!hasChart} onChange={(value) => set("aspectGrid", value)} />
                    <Check label={t("settings.dashboard.declination")} checked={choice.declination} disabled={!hasChart} onChange={(value) => set("declination", value)} />
                    <Check label={t("settings.dashboard.moon")} checked={choice.moon} disabled={!hasChart} onChange={(value) => set("moon", value)} />
                  </Group>
                  <Group title={t("astrolabe.poster.groupPaper")}>
                    <Check label={t("astrolabe.poster.neatline")} checked={choice.neatline} onChange={(value) => set("neatline", value)} />
                    <Check label={t("astrolabe.poster.facts")} checked={choice.facts} disabled={!hasChart} onChange={(value) => set("facts", value)} />
                  </Group>
                </div>
              </div>
            </TabsContent>
          </Tabs>
          <div className="flex h-[min(26rem,60vh)] items-start justify-center">
            <PosterSchematic layout={layout} label={t("astrolabe.poster.preview")} />
          </div>
        </div>
        {failure ? (
          <p role="alert" className="text-[length:var(--aries-font-size-small)] text-destructive">
            {t(failure === "modules" ? "astrolabe.poster.modulesFailed" : "astrolabe.poster.plateFailed")}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("astrolabe.poster.cancel")}
          </Button>
          <Button disabled={!canExport} onClick={onExport}>
            {t("astrolabe.poster.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
