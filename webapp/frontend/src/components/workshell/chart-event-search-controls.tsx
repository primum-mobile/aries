// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/i18n";
import { LIST_BUTTON_PROPS, LIST_PANE_CLASSES } from "@/lib/list-tokens";
import type { ChartPickerAspectClause, ChartPickerPlacementClause } from "@/lib/daemon/client";
import { activeEventAspects, activeEventPlacements, useChartEventSearchStore } from "@/stores/chart-event-search-store";
import { ChartSearchMultiChoice } from "./chart-search-multi-choice";

const emptyPlacement = (): ChartPickerPlacementClause => ({
  objectIds: [], signIndices: [], degree: "", degreeOrb: "1", houseNumbers: [], motion: "",
});
const emptyAspect = (): ChartPickerAspectClause => ({
  objectAIds: [], aspectType: "-1", objectBIds: [], orb: "1",
});
const replaceAt = <T,>(items: T[], index: number, value: T) => items.map((item, i) => i === index ? value : item);
const removeAt = <T,>(items: T[], index: number) => items.filter((_item, i) => i !== index);

function SearchField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-w-0 gap-[var(--aries-control-gap-compact)]">
    <span className="text-[length:var(--aries-font-size-small)] text-muted-foreground">{label}</span>
    {children}
  </div>;
}

export function ChartEventSearchControls({ documentId, onSearch, onShowAll }: {
  documentId: string;
  onSearch: () => void;
  onShowAll: () => void;
}) {
  const t = useT();
  const view = useChartEventSearchStore((state) => state.views[documentId]);
  if (!view?.open) return null;
  const update = (next: Partial<typeof view>) => useChartEventSearchStore.getState().patch(documentId, next);
  const catalog = view.catalog;
  const placementCount = activeEventPlacements(view.placements).length;
  const aspectCount = activeEventAspects(view.aspects).length;
  return (
    <div className="grid gap-[var(--aries-control-gap)] border-b border-border px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-padding-y)]">
      <div className={LIST_PANE_CLASSES.controlRow}>
        <span>{t("picker.placements")}</span>
        <Button type="button" {...LIST_BUTTON_PROPS.command} className="ml-auto"
          onClick={() => update({ placements: [...view.placements, emptyPlacement()] })}>
          <Plus aria-hidden="true" />{t("chartEvents.addPlacement")}
        </Button>
      </div>
      {view.placements.map((row, index) => {
        const change = (next: ChartPickerPlacementClause) => update({ placements: replaceAt(view.placements, index, next) });
        return <div key={index} className="grid gap-[var(--aries-control-gap)] border-b border-border/40 pb-[var(--aries-control-gap)]">
          <div className={LIST_PANE_CLASSES.controlRow}>
            <span className="aries-list-secondary-text">{t("chartEvents.placementNumber", { number: index + 1 })}</span>
            <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" disabled={view.placements.length === 1}
              aria-label={t("picker.ariaRemovePlacement")}
              onClick={() => update({ placements: removeAt(view.placements, index) })}><Trash2 /></Button>
          </div>
          <div className="grid grid-cols-2 gap-[var(--aries-control-gap)]">
            <SearchField label={t("chartEvents.point")}>
              <ChartSearchMultiChoice values={row.objectIds} choices={catalog?.objects} anyLabel={t("chartEvents.anyPoint")}
                exclude={row.exclude} onExcludeChange={(exclude) => change({ ...row, exclude })}
                ariaLabel={t("picker.ariaPlacementObject")} onChange={(objectIds) => change({ ...row, objectIds })} />
            </SearchField>
            <SearchField label={t("picker.sign")}>
              <ChartSearchMultiChoice values={row.signIndices} choices={catalog?.signs} anyLabel={t("chartEvents.anySign")}
                ariaLabel={t("picker.ariaPlacementSign")} onChange={(signIndices) => change({ ...row, signIndices })} />
            </SearchField>
            <SearchField label={t("chartEvents.degreeInSign")}>
              <Input value={row.degree} aria-label={t("chartEvents.degreeInSign")} placeholder={t("chartEvents.anyDegree")}
                onChange={(event) => change({ ...row, degree: event.target.value })} />
            </SearchField>
            <SearchField label={t("chartEvents.degreeOrb")}>
              <Input value={row.degreeOrb} aria-label={t("chartEvents.degreeOrb")} disabled={!row.degree.trim()}
                onChange={(event) => change({ ...row, degreeOrb: event.target.value })} />
            </SearchField>
            <SearchField label={t("picker.house")}>
              <ChartSearchMultiChoice values={row.houseNumbers} choices={catalog?.houses} anyLabel={t("chartEvents.anyHouse")}
                ariaLabel={t("picker.ariaPlacementHouse")} onChange={(houseNumbers) => change({ ...row, houseNumbers })} />
            </SearchField>
            <SearchField label={t("picker.motion")}>
              <ChartSearchMultiChoice values={row.motions ?? (row.motion ? [row.motion] : [])} choices={catalog?.motions}
                anyLabel={t("chartEvents.anyMotion")}
                ariaLabel={t("picker.ariaPlacementMotion")} onChange={(motions) => change({ ...row, motions, motion: "" })} />
            </SearchField>
          </div>
        </div>;
      })}
      <div className={LIST_PANE_CLASSES.controlRow}>
        <span>{t("picker.aspects")}</span>
        <Button type="button" {...LIST_BUTTON_PROPS.command} className="ml-auto"
          onClick={() => update({ aspects: [...view.aspects, emptyAspect()] })}>
          <Plus aria-hidden="true" />{t("chartEvents.addAspect")}
        </Button>
      </div>
      {view.aspects.map((row, index) => {
        const change = (next: ChartPickerAspectClause) => update({ aspects: replaceAt(view.aspects, index, next) });
        return <div key={index} className="grid gap-[var(--aries-control-gap)] border-b border-border/40 pb-[var(--aries-control-gap)]">
          <div className={LIST_PANE_CLASSES.controlRow}>
            <span className="aries-list-secondary-text">{t("chartEvents.aspectNumber", { number: index + 1 })}</span>
            <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" disabled={view.aspects.length === 1}
              aria-label={t("picker.ariaRemoveAspect")}
              onClick={() => update({ aspects: removeAt(view.aspects, index) })}><Trash2 /></Button>
          </div>
          <div className="grid grid-cols-2 gap-[var(--aries-control-gap)]">
            <SearchField label={t("chartEvents.firstPoint")}>
              <ChartSearchMultiChoice values={row.objectAIds} choices={catalog?.objects} anyLabel={t("chartEvents.anyPoint")}
                exclude={row.exclude} onExcludeChange={(exclude) => change({ ...row, exclude })}
                ariaLabel={t("picker.ariaAspectFirstBody")} onChange={(objectAIds) => change({ ...row, objectAIds })} />
            </SearchField>
            <SearchField label={t("picker.aspect")}>
              <ChartSearchMultiChoice values={row.aspectTypes ?? (row.aspectType !== "-1" ? [row.aspectType] : [])}
                choices={catalog?.aspects} anyLabel={t("chartEvents.selectAspect")}
                ariaLabel={t("picker.ariaAspectType")}
                onChange={(aspectTypes) => change({ ...row, aspectTypes, aspectType: "-1" })} />
            </SearchField>
            <SearchField label={t("chartEvents.secondPoint")}>
              <ChartSearchMultiChoice values={row.objectBIds} choices={catalog?.objects} anyLabel={t("chartEvents.anyPoint")}
                ariaLabel={t("picker.ariaAspectSecondBody")} onChange={(objectBIds) => change({ ...row, objectBIds })} />
            </SearchField>
            <SearchField label={t("picker.orb")}>
              <Input value={row.orb} aria-label={t("picker.ariaAspectOrb")}
                disabled={!activeEventAspects([row]).length
                  || (row.aspectTypes?.length === 1 ? row.aspectTypes[0] === "-2" : row.aspectType === "-2")}
                onChange={(event) => change({ ...row, orb: event.target.value })} />
            </SearchField>
          </div>
        </div>;
      })}
      <div className={`${LIST_PANE_CLASSES.controlRow} sticky bottom-0 z-10 border-t border-border/40 bg-background py-[var(--aries-pane-header-padding-y)]`}>
        <Button type="button" {...LIST_BUTTON_PROPS.command} variant={view.includeAsteroids ? "default" : LIST_BUTTON_PROPS.command.variant}
          aria-pressed={view.includeAsteroids} onClick={() => update({ includeAsteroids: !view.includeAsteroids })}>
          {t("chartmenu.asteroids")}
        </Button>
        <Button type="button" {...LIST_BUTTON_PROPS.command} className="ml-auto" disabled={!catalog || (!placementCount && !aspectCount)}
          onClick={onSearch}>{t("picker.search")}</Button>
        {view.active ? <Button type="button" {...LIST_BUTTON_PROPS.command} onClick={onShowAll}>{t("chartEvents.showAllEvents")}</Button> : null}
      </div>
    </div>
  );
}
