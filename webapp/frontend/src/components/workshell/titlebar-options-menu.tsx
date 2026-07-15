// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  applyThemePreset,
  fetchOptions,
  patchOptions,
  type OptionsDisplay,
  type OptionsPayload,
  type OptionsPatch,
  type OptionsQuickCharts,
  type OptionsRevolutions,
  type OptionsStepAlerts,
  type OptionsSymbols,
} from "@/lib/daemon/client";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { useThemeStore } from "@/stores/theme-store";
import type { SettingsTabId } from "./settings-dialog";

type Props = {
  onOptionsPatched?: (next?: OptionsPayload) => void;
  onOpenSettings?: (tab?: SettingsTabId) => void;
  pdChartOrientationDisabled?: boolean;
};

const MINOR_ASPECT_INDICES = new Set([1, 2, 4, 7, 8, 9, 11]);
const FIXED_STAR_SUBMODE_VALUES = new Set([1, 6, 7, 8]);

export function TitlebarOptionsMenu({ onOptionsPatched, onOpenSettings, pdChartOrientationDisabled = false }: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [loadToken, setLoadToken] = React.useState(0);
  const [opts, setOpts] = React.useState<OptionsPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const optsRef = React.useRef<OptionsPayload | null>(null);
  const applyThemeState = useThemeStore((state) => state.applyThemeState);

  const reconcile = React.useCallback((next: OptionsPayload) => {
    setOpts(next);
    applyThemeState(next.themeState);
    onOptionsPatched?.(next);
  }, [applyThemeState, onOptionsPatched]);

  React.useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  React.useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    fetchOptions(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setOpts(next);
          applyThemeState(next.themeState);
        }
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [applyThemeState, loadToken, open]);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setLoading(optsRef.current === null);
      setError(null);
      setLoadToken((token) => token + 1);
    }
  }, []);

  const applyPatch = React.useCallback((patch: OptionsPatch) => {
    setBusy(true);
    setError(null);
    patchOptions(patch)
      .then(reconcile)
      .catch((err) => {
        console.error("[titlebar-options-patch]", err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  }, [reconcile]);

  const applyPreset = React.useCallback((name: string) => {
    setBusy(true);
    setError(null);
    applyThemePreset(name)
      .then(reconcile)
      .catch((err) => {
        console.error("[titlebar-theme-preset]", err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  }, [reconcile]);

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        aria-label={t("quickopt.quickOptions")}
        title={t("quickopt.quickOptions")}
        className={cn(
          "flex h-[var(--morinus-header-btn-h)] w-[var(--morinus-header-btn-w)] items-center justify-center rounded-[var(--morinus-header-btn-radius)] text-[color:var(--aries-titlebar-icon)] outline-none transition-colors duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)] hover:bg-sidebar-accent hover:text-[color:var(--aries-titlebar-icon-hover)] focus-visible:bg-sidebar-accent focus-visible:text-[color:var(--aries-titlebar-icon-hover)]",
          open && "bg-sidebar-accent text-[color:var(--aries-titlebar-icon-active)]",
        )}
      >
        <SlidersHorizontal className="size-[var(--morinus-header-icon-size)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(76vh,620px)] w-72 rounded-[5px]">
        {loading && !opts ? (
          <DropdownMenuItem disabled>{t("quickopt.loadingOptions")}</DropdownMenuItem>
        ) : opts ? (
          <OptionsMenuBody
            opts={opts}
            busy={busy}
            applyPatch={applyPatch}
            applyPreset={applyPreset}
            onOpenSettings={onOpenSettings}
            pdChartOrientationDisabled={pdChartOrientationDisabled}
          />
        ) : (
          <DropdownMenuItem disabled>{t("quickopt.optionsUnavailable")}</DropdownMenuItem>
        )}
        {error ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-destructive">
              {error}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OptionsMenuBody({
  opts,
  busy,
  applyPatch,
  applyPreset,
  onOpenSettings,
  pdChartOrientationDisabled,
}: {
  opts: OptionsPayload;
  busy: boolean;
  applyPatch: (patch: OptionsPatch) => void;
  applyPreset: (name: string) => void;
  onOpenSettings?: (tab?: SettingsTabId) => void;
  pdChartOrientationDisabled: boolean;
}) {
  const t = useT();
  const d = opts.display;
  const q = opts.quickCharts;
  const p = opts.planetsPoints;
  const cat = opts.catalog;
  const locationModeChoices = [
    { value: "0", label: t("quickopt.useNatal") },
    { value: "1", label: t("quickopt.ask") },
  ];

  const patchDisplay = (fields: Partial<OptionsDisplay>) => applyPatch({ display: fields });
  const patchQuickCharts = (fields: Partial<OptionsQuickCharts>) => applyPatch({ quickCharts: fields });
  const patchPlanetsPoints = (fields: NonNullable<OptionsPatch["planetsPoints"]>) => {
    applyPatch({ planetsPoints: fields });
  };
  const patchSymbols = (fields: Partial<OptionsSymbols>) => applyPatch({ symbols: fields });
  const patchStepAlerts = (fields: Partial<OptionsStepAlerts>) => applyPatch({ stepAlerts: fields });
  const patchRevolutions = (fields: Partial<OptionsRevolutions>) => applyPatch({ revolutions: fields });

  const setAspectVector = (index: number, value: boolean) => {
    const next = [...d.aspect];
    next[index] = value;
    patchDisplay({
      aspect: next,
      ...(value && MINOR_ASPECT_INDICES.has(index) ? { traditionalaspects: false } : {}),
    });
  };
  const setTranscendental = (index: number, value: boolean) => {
    const next = [...d.transcendental];
    next[index] = value;
    patchDisplay({ transcendental: next });
  };
  const setTraditionalAspects = (value: boolean) => {
    const patch: Partial<OptionsDisplay> = { traditionalaspects: value };
    if (value) {
      const next = [...d.aspect];
      for (const index of MINOR_ASPECT_INDICES) next[index] = false;
      patch.aspect = next;
    }
    patchDisplay(patch);
  };
  const setShownodes = (value: boolean) => {
    patchDisplay({ shownodes: value, ...(!value ? { aspectstonodes: false } : {}) });
  };
  const setShowvertex = (value: boolean) => {
    patchDisplay({ showvertex: value, ...(!value ? { showaspectstovertex: false } : {}) });
  };
  const setShowlof = (value: boolean) => {
    patchDisplay({
      showlof: value,
      ...(!value ? { showaspectstolof: false, showlofouterring: false } : {}),
    });
  };
  const setFixstarsMode = (value: number) => {
    patchDisplay({
      showfixstars: value,
      ...(!FIXED_STAR_SUBMODE_VALUES.has(value)
        ? { showfixstarsnodes: false, showfixstarshcs: false, showfixstarslof: false }
        : {}),
    });
  };
  const setTerms = (value: boolean) => {
    applyPatch({ display: { showterms: value }, dignities: { showterms: value } });
  };
  const setExclusiveAspects = (value: boolean) => {
    patchDisplay({
      exclusive_aspects_on_click: value,
      ...(!value
        ? {
            exclusive_aspects_on_click_show_minor: false,
            exclusive_aspects_on_click_traditional: false,
          }
        : {}),
    });
  };
  const setStepAlertVector = (
    attr: "stepalerts_promplanets" | "stepalerts_sigplanets" | "stepalerts_sigangles",
    index: number,
    value: boolean,
  ) => {
    const next = [...opts.stepAlerts[attr]];
    next[index] = value;
    patchStepAlerts({ [attr]: next });
  };

  return (
    <>
      <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
        {t("quickopt.options")}
      </div>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.nodeCalculation")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-48 rounded-[5px]">
          <DropdownMenuRadioGroup
            value={p.meannode ? "1" : "0"}
            onValueChange={(value) => patchPlanetsPoints({ meannode: value === "1" })}
          >
            {cat.nodeModes.map((mode) => (
              <DropdownMenuRadioItem key={mode.value} value={String(mode.value)} disabled={busy}>
                {mode.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <RadioSubmenu
        label={t("quickopt.ayanamsha")}
        value={String(opts.ayanamsha.ayanamsha)}
        disabled={busy}
        choices={opts.ayanamsha.available.map((entry) => ({
          value: String(entry.index),
          label: entry.label,
        }))}
        onValueChange={(value) => applyPatch({ ayanamsha: { ayanamsha: Number(value) } })}
      />
      <RadioSubmenu
        label={t("quickopt.houseSystem")}
        value={opts.houseSystem.hsys}
        disabled={busy}
        choices={opts.houseSystem.available.map((entry) => ({
          value: entry.code,
          label: entry.label,
        }))}
        onValueChange={(value) => applyPatch({ houseSystem: { hsys: value } })}
      />
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.chartLayers")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-56 rounded-[5px]">
          <RadioNested label={t("quickopt.wheelLayout")} value={String(d.theme)} disabled={busy} choices={cat.themeLayouts.map((mode) => ({ value: String(mode.value), label: mode.label }))} onValueChange={(value) => patchDisplay({ theme: Number(value) })} />
          <DropdownMenuSeparator />
          <CheckItem checked={d.houses} disabled={busy} onChange={(value) => patchDisplay({ houses: value })}>{t("quickopt.houses")}</CheckItem>
          <CheckItem checked={d.housesystem} disabled={busy} onChange={(value) => patchDisplay({ housesystem: value })}>{t("quickopt.houseSystemLabel")}</CheckItem>
          <CheckItem checked={d.showchiron} disabled={busy} onChange={(value) => patchDisplay({ showchiron: value })}>{t("quickopt.chiron")}</CheckItem>
          <CheckItem checked={d.showvertex} disabled={busy} onChange={setShowvertex}>{t("quickopt.vertex")}</CheckItem>
          <CheckItem checked={d.shownodes} disabled={busy} onChange={setShownodes}>{t("quickopt.nodes")}</CheckItem>
          <CheckItem checked={d.showlof} disabled={busy} onChange={setShowlof}>{t("quickopt.fortuna")}</CheckItem>
          <CheckItem checked={d.showprenatalsyzygy} disabled={busy} onChange={(value) => patchDisplay({ showprenatalsyzygy: value })}>{t("quickopt.prenatalSyzygy")}</CheckItem>
          <CheckItem checked={d.positions} disabled={busy} onChange={(value) => patchDisplay({ positions: value })}>{t("quickopt.speculum")}</CheckItem>
          <CheckItem checked={d.intables} disabled={busy} onChange={(value) => patchDisplay({ intables: value })}>{t("quickopt.inTables")}</CheckItem>
          <CheckItem checked={d.showterms} disabled={busy} onChange={setTerms}>{t("quickopt.terms")}</CheckItem>
          <CheckItem checked={d.showdecans} disabled={busy} onChange={(value) => patchDisplay({ showdecans: value })}>{t("quickopt.decans")}</CheckItem>
          <CheckItem checked={d.topocentric} disabled={busy} onChange={(value) => patchDisplay({ topocentric: value })}>{t("quickopt.topocentricMoon")}</CheckItem>
          <CheckItem checked={d.morin_antiscia} disabled={busy} onChange={(value) => patchDisplay({ morin_antiscia: value })}>{t("quickopt.morinAntiscia")}</CheckItem>
          <RadioNested
            label={t("settings.pdChartOrientation")}
            value={opts.primaryDirections.pdinchartreverse ? "promissor" : "reverse"}
            disabled={busy || pdChartOrientationDisabled}
            choices={[
              { value: "promissor", label: t("settings.promissorToSignificator") },
              { value: "reverse", label: t("settings.reverseWheelRotation") },
            ]}
            onValueChange={(value) => applyPatch({
              primaryDirections: { pdinchartreverse: value === "promissor" },
            })}
          />
          {cat.transcendentalLabels.length ? <DropdownMenuSeparator /> : null}
          {cat.transcendentalLabels.map((body, index) => (
            <CheckItem
              key={body.label}
              checked={Boolean(d.transcendental[index])}
              disabled={busy}
              onChange={(value) => setTranscendental(index, value)}
            >
              <Glyph ch={body.glyph} /> {body.label}
            </CheckItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.aspects")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-60 rounded-[5px]">
          <CheckItem checked={d.aspects} disabled={busy} onChange={(value) => patchDisplay({ aspects: value })}>{t("quickopt.aspects")}</CheckItem>
          <CheckItem checked={d.symbols} disabled={busy || !d.aspects} onChange={(value) => patchDisplay({ symbols: value })}>{t("quickopt.withSymbols")}</CheckItem>
          <CheckItem checked={d.traditionalaspects} disabled={busy || !d.aspects} onChange={setTraditionalAspects}>{t("quickopt.traditionalOnly")}</CheckItem>
          <CheckItem checked={d.showaspectstovertex} disabled={busy || !d.aspects || !d.showvertex} onChange={(value) => patchDisplay({ showaspectstovertex: value })}>{t("quickopt.aspectsToVertex")}</CheckItem>
          <CheckItem checked={d.aspectstonodes} disabled={busy || !d.aspects || !d.shownodes} onChange={(value) => patchDisplay({ aspectstonodes: value })}>{t("quickopt.aspectsToNodes")}</CheckItem>
          <CheckItem checked={d.showaspectstolof} disabled={busy || !d.aspects || !d.showlof} onChange={(value) => patchDisplay({ showaspectstolof: value })}>{t("quickopt.aspectsToFortuna")}</CheckItem>
          <CheckItem checked={d.showlofouterring} disabled={busy || !d.showlof} onChange={(value) => patchDisplay({ showlofouterring: value })}>{t("quickopt.outerRingFortunaLabel")}</CheckItem>
          <DropdownMenuSeparator />
          {cat.aspectLabels.map((label, index) => (
            <CheckItem
              key={`${label}-${index}`}
              checked={Boolean(d.aspect[index])}
              disabled={busy || !d.aspects || (d.traditionalaspects && MINOR_ASPECT_INDICES.has(index))}
              onChange={(value) => setAspectVector(index, value)}
            >
              <Glyph ch={cat.aspectGlyphs[index] ?? ""} /> {label}
            </CheckItem>
          ))}
          <DropdownMenuSeparator />
          <CheckItem checked={d.exclusive_aspects_on_click} disabled={busy || !d.aspects} onChange={setExclusiveAspects}>{t("quickopt.exclusiveOnClick")}</CheckItem>
          <CheckItem
            checked={d.exclusive_aspects_on_click_show_minor}
            disabled={busy || !d.aspects || !d.exclusive_aspects_on_click || d.exclusive_aspects_on_click_traditional}
            onChange={(value) => patchDisplay({
              exclusive_aspects_on_click_show_minor: value,
              ...(value ? { exclusive_aspects_on_click_traditional: false } : {}),
            })}
          >
            {t("quickopt.exclusiveClickShowMinor")}
          </CheckItem>
          <CheckItem
            checked={d.exclusive_aspects_on_click_traditional}
            disabled={busy || !d.aspects || !d.exclusive_aspects_on_click}
            onChange={(value) => patchDisplay({
              exclusive_aspects_on_click_traditional: value,
              ...(value ? { exclusive_aspects_on_click_show_minor: false } : {}),
            })}
          >
            {t("quickopt.exclusiveClickTraditional")}
          </CheckItem>
          <CheckItem
            checked={!d.aspect_thickness_mode && !d.aspect_opacity_mode}
            disabled={busy || !d.aspects}
            onChange={(value) => value && patchDisplay({ aspect_thickness_mode: false, aspect_opacity_mode: false })}
          >
            {t("quickopt.standard")}
          </CheckItem>
          <CheckItem inset checked={d.aspect_thickness_mode} disabled={busy || !d.aspects} onChange={(value) => patchDisplay({ aspect_thickness_mode: value })}>{t("quickopt.lineThickness")}</CheckItem>
          <CheckItem inset checked={d.aspect_opacity_mode} disabled={busy || !d.aspects} onChange={(value) => patchDisplay({ aspect_opacity_mode: value })}>{t("quickopt.opacity")}</CheckItem>
          <CheckItem checked={d.aspect_flag_show_parties} disabled={busy || !d.aspects} onChange={(value) => patchDisplay({ aspect_flag_show_parties: value })}>{t("quickopt.planetsInHoverFlag")}</CheckItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.outerRingAndSignals")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-56 rounded-[5px]">
          <RadioGroupItems
            value={String(d.showfixstars)}
            choices={cat.fixstarsModes.map((mode) => ({ value: String(mode.value), label: mode.label }))}
            disabled={busy}
            onValueChange={(value) => setFixstarsMode(Number(value))}
          />
          <DropdownMenuSeparator />
          <CheckItem checked={d.showfixstarsnodes} disabled={busy || !FIXED_STAR_SUBMODE_VALUES.has(d.showfixstars)} onChange={(value) => patchDisplay({ showfixstarsnodes: value })}>{t("quickopt.fixstarsToNodes")}</CheckItem>
          <CheckItem checked={d.showfixstarshcs} disabled={busy || !FIXED_STAR_SUBMODE_VALUES.has(d.showfixstars)} onChange={(value) => patchDisplay({ showfixstarshcs: value })}>{t("quickopt.fixstarsToIntermediateHcs")}</CheckItem>
          <CheckItem checked={d.showfixstarslof} disabled={busy || !FIXED_STAR_SUBMODE_VALUES.has(d.showfixstars)} onChange={(value) => patchDisplay({ showfixstarslof: value })}>{t("quickopt.fixstarsToFortuna")}</CheckItem>
          <DropdownMenuSeparator />
          <RadioNested label={t("quickopt.phasisMode")} value={String(d.phasismode)} disabled={busy} choices={cat.phasisModes.map((mode) => ({ value: String(mode.value), label: mode.label }))} onValueChange={(value) => patchDisplay({ phasismode: Number(value) })} />
          <CheckItem checked={d.extendedradixstations} disabled={busy} onChange={(value) => patchDisplay({ extendedradixstations: value })}>{t("quickopt.phasisModernPlanets")}</CheckItem>
          <CheckItem checked={d.showcazimi} disabled={busy} onChange={(value) => patchDisplay({ showcazimi: value })}>{t("quickopt.cazimi")}</CheckItem>
          <RadioNested label={t("quickopt.cazimiMode")} value={String(d.cazimimode)} disabled={busy} choices={cat.cazimiModes.map((mode) => ({ value: String(mode.value), label: mode.label }))} onValueChange={(value) => patchDisplay({ cazimimode: Number(value) })} />
          <RadioNested label={t("quickopt.synodicShiftArrow")} value={String(d.synodicmode)} disabled={busy} choices={cat.synodicModes.map((mode) => ({ value: String(mode.value), label: mode.label }))} onValueChange={(value) => patchDisplay({ synodicmode: Number(value) })} />
          <CheckItem checked={d.showeclipseoverlay} disabled={busy} onChange={(value) => patchDisplay({ showeclipseoverlay: value })}>{t("quickopt.eclipseOverlay")}</CheckItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.planetsAndPoints")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-64 rounded-[5px]">
          <RadioNested
            label={t("quickopt.lotOfFortune")}
            value={String(p.lotoffortune)}
            disabled={busy}
            choices={cat.fortunaModes.map((mode) => ({ value: String(mode.value), label: mode.label }))}
            onValueChange={(value) => patchPlanetsPoints({ lotoffortune: Number(value) })}
          />
          <RadioNested
            label={t("quickopt.syzygy")}
            value={String(p.syzmoon)}
            disabled={busy}
            choices={cat.syzygyModes.map((mode) => ({ value: String(mode.value), label: mode.label }))}
            onValueChange={(value) => patchPlanetsPoints({ syzmoon: Number(value) })}
          />
          <RadioNested
            label={t("quickopt.arabicPartsReference")}
            value={String(p.arabicpartsref)}
            disabled={busy}
            choices={cat.arabicPartsRefs.map((mode) => ({ value: String(mode.value), label: mode.label }))}
            onValueChange={(value) => patchPlanetsPoints({ arabicpartsref: Number(value) })}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy} onClick={() => onOpenSettings?.("planets")}>{t("quickopt.openPlanetsPointsSettings")}</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.headerAndLayout")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-56 rounded-[5px]">
          <CheckItem checked={q.subcharts_open_compound_default} disabled={busy} onChange={(value) => patchQuickCharts({ subcharts_open_compound_default: value })}>{t("quickopt.subChartsAsBiwheels")}</CheckItem>
          <CheckItem checked={d.planetarydayhour} disabled={busy} onChange={(value) => patchDisplay({ planetarydayhour: value })}>{t("quickopt.planetaryHour")}</CheckItem>
          <CheckItem checked={d.information} disabled={busy} onChange={(value) => patchDisplay({ information: value })}>{t("quickopt.information")}</CheckItem>
          <CheckItem checked={d.showseconds} disabled={busy} onChange={(value) => patchDisplay({ showseconds: value })}>{t("quickopt.secondsInHeader")}</CheckItem>
          <RadioNested label={t("quickopt.dateFormat")} value={d.dateconvention} disabled={busy} choices={cat.dateConventions.map((mode) => ({ value: mode.value, label: mode.label }))} onValueChange={(value) => patchDisplay({ dateconvention: value })} />
          <RadioNested label={t("quickopt.typeface")} value={d.fontfamily} disabled={busy || cat.fontProfiles.length === 0} choices={cat.fontProfiles.map((mode) => ({ value: mode.value, label: mode.label }))} onValueChange={(value) => patchDisplay({ fontfamily: value })} />
          <CheckItem checked={d.show_help_chip} disabled={busy} onChange={(value) => patchDisplay({ show_help_chip: value })}>{t("quickopt.chartNavigationBar")}</CheckItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.symbols")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-48 rounded-[5px]">
          <SymbolRadio
            label={t("quickopt.uranus")}
            value={opts.symbols.uranus}
            choices={cat.symbolUranus}
            disabled={busy}
            onChange={(value) => patchSymbols({ uranus: value === "true" })}
          />
          <SymbolRadio
            label={t("quickopt.pluto")}
            value={opts.symbols.pluto}
            choices={cat.symbolPluto}
            disabled={busy}
            onChange={(value) => patchSymbols({ pluto: Number(value) })}
          />
          <SymbolRadio
            label={t("quickopt.signs")}
            value={opts.symbols.signs}
            choices={cat.symbolSigns}
            disabled={busy}
            onChange={(value) => patchSymbols({ signs: value === "true" })}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.progressionsAndReturns")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-64 rounded-[5px]">
          <RadioNested label={t("quickopt.progressedAngles")} value={String(q.progressed_angle_method)} disabled={busy} choices={cat.progressionAngleMethods.map((mode) => ({ value: String(mode.value), label: mode.label }))} onValueChange={(value) => patchQuickCharts({ progressed_angle_method: Number(value) })} />
          <RadioNested label={t("quickopt.progressionDayType")} value={String(q.progression_day_type)} disabled={busy} choices={cat.progressionDayTypes.map((mode) => ({ value: String(mode.value), label: mode.label }))} onValueChange={(value) => patchQuickCharts({ progression_day_type: Number(value) })} />
          <RadioNested label={t("quickopt.progressionsTransits")} value={String(q.secondary_progression_launch_mode)} disabled={busy} choices={cat.secondaryLaunchModes.map((mode) => ({ value: String(mode.value), label: mode.label }))} onValueChange={(value) => patchQuickCharts({ secondary_progression_launch_mode: Number(value) })} />
          <RadioNested label={t("quickopt.tableTimes")} value={q.event_table_time_basis} disabled={busy} choices={cat.eventTableTimeModes.map((mode) => ({ value: mode.value, label: mode.label }))} onValueChange={(value) => patchQuickCharts({ event_table_time_basis: value })} />
          <CheckItem checked={q.timed_chart_show_radix_default} disabled={busy} onChange={(value) => patchQuickCharts({ timed_chart_show_radix_default: value })}>{t("quickopt.timedRowsShowRadix")}</CheckItem>
          <DropdownMenuSeparator />
          <RadioNested label={t("quickopt.solarReturnYear")} value={String(opts.revolutions.revolutions_solaryearmode)} disabled={busy} choices={[{ value: "0", label: t("quickopt.currentYear") }, { value: "1", label: t("quickopt.nextYear") }]} onValueChange={(value) => patchRevolutions({ revolutions_solaryearmode: Number(value) })} />
          <RadioNested label={t("quickopt.solarReturnLocation")} value={String(opts.revolutions.revolutions_solarlocationmode)} disabled={busy} choices={locationModeChoices} onValueChange={(value) => patchRevolutions({ revolutions_solarlocationmode: Number(value) })} />
          <CheckItem checked={opts.revolutions.revolutions_solarreturnmode === "tithi_pravesha"} disabled={busy} onChange={(value) => patchRevolutions({ revolutions_solarreturnmode: value ? "tithi_pravesha" : "standard" })}>{t("chartmenu.tithiPravesha")}</CheckItem>
          <RadioNested label={t("quickopt.lunarReturnLocation")} value={String(opts.revolutions.revolutions_lunarlocationmode)} disabled={busy} choices={locationModeChoices} onValueChange={(value) => patchRevolutions({ revolutions_lunarlocationmode: Number(value) })} />
          <CheckItem checked={opts.revolutions.revolutions_lunarreturnmode === "soli_lunar"} disabled={busy} onChange={(value) => patchRevolutions({ revolutions_lunarreturnmode: value ? "soli_lunar" : "lunar" })}>{t("chartmenu.lunarPhaseEmbolismic")}</CheckItem>
          <CheckItem checked={opts.revolutions.revolutions_lunarreturnmode === "jonas_arc"} disabled={busy} onChange={(value) => patchRevolutions({ revolutions_lunarreturnmode: value ? "jonas_arc" : "lunar" })}>{t("chartmenu.jonasArc")}</CheckItem>
          <RadioNested label={t("quickopt.planetaryReturnLocation")} value={String(opts.revolutions.revolutions_planetslocationmode)} disabled={busy} choices={locationModeChoices} onValueChange={(value) => patchRevolutions({ revolutions_planetslocationmode: Number(value) })} />
          <CheckItem checked={opts.revolutions.revsidereal_marr_solar} disabled={busy} onChange={(value) => patchRevolutions({ revsidereal_marr_solar: value })}>{t("quickopt.marrSiderealSolarReturns")}</CheckItem>
          <CheckItem checked={opts.revolutions.revsidereal_marr_lunar} disabled={busy} onChange={(value) => patchRevolutions({ revsidereal_marr_lunar: value })}>{t("quickopt.marrSiderealLunarReturns")}</CheckItem>
          <CheckItem checked={opts.revolutions.revsidereal_marr_planet} disabled={busy} onChange={(value) => patchRevolutions({ revsidereal_marr_planet: value })}>{t("quickopt.marrSiderealPlanetaryReturns")}</CheckItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.timeLordsAndAlerts")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-60 rounded-[5px]">
          <CheckItem checked={opts.profections.wholeSign} disabled={busy} onChange={(value) => applyPatch({ profections: { wholeSign: value } })}>{t("quickopt.wholeSignProfections")}</CheckItem>
          <CheckItem checked={opts.profections.zodiacal} disabled={busy} onChange={(value) => applyPatch({ profections: { zodiacal: value } })}>{t("quickopt.zodiacalProfections")}</CheckItem>
          <CheckItem checked={opts.profections.useZodProjs} disabled={busy} onChange={(value) => applyPatch({ profections: { useZodProjs: value } })}>{t("quickopt.useZodiacalProjections")}</CheckItem>
          <CheckItem checked={opts.profections.solarReturnSnap} disabled={busy} onChange={(value) => applyPatch({ profections: { solarReturnSnap: value } })}>{t("quickopt.snapToSolarReturn")}</CheckItem>
          <RadioNested label={t("quickopt.firdariaOrder")} value={opts.firdaria.isfirbonatti ? "1" : "0"} disabled={busy} choices={cat.firdariaModes.map((mode) => ({ value: mode.value ? "1" : "0", label: mode.label }))} onValueChange={(value) => applyPatch({ firdaria: { isfirbonatti: value === "1" } })} />
          <DropdownMenuSeparator />
          <CheckItem checked={opts.stepAlerts.stepalerts_enabled} disabled={busy} onChange={(value) => patchStepAlerts({ stepalerts_enabled: value })}>{t("quickopt.stepConjunctionAlerts")}</CheckItem>
          {cat.stepAlertBodies.slice(0, opts.stepAlerts.stepalerts_promplanets.length).map((body, index) => (
            <CheckItem key={`prom-${body.id}`} checked={Boolean(opts.stepAlerts.stepalerts_promplanets[index])} disabled={busy || !opts.stepAlerts.stepalerts_enabled} onChange={(value) => setStepAlertVector("stepalerts_promplanets", index, value)}>
              <Glyph ch={body.glyph} /> {t("quickopt.alertPromissor", { body: body.label })}
            </CheckItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.otherOptions")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-60 rounded-[5px]">
          <RadioNested label={t("quickopt.lunarMansionsZodiac")} value={opts.lunarMansions.manazil_zodiac} disabled={busy} choices={cat.mansionZodiacModes.map((mode) => ({ value: mode.value, label: mode.label }))} onValueChange={(value) => applyPatch({ lunarMansions: { manazil_zodiac: value } })} />
          <RadioNested label={t("quickopt.eclipseChartMoment")} value={opts.eclipses.eclipse_chart_moment} disabled={busy} choices={cat.eclipseModes.map((mode) => ({ value: mode.value, label: mode.label }))} onValueChange={(value) => applyPatch({ eclipses: { eclipse_chart_moment: value } })} />
          <RadioNested label={t("quickopt.relationshipLauncher")} value={opts.relationshipCharts.synastry_opens_composite_first ? "1" : "0"} disabled={busy} choices={cat.relationshipLauncherModes.map((mode) => ({ value: mode.value ? "1" : "0", label: mode.label }))} onValueChange={(value) => applyPatch({ relationshipCharts: { synastry_opens_composite_first: value === "1" } })} />
          <CheckItem checked={d.astrocart_localspace_additive} disabled={busy} onChange={(value) => patchDisplay({ astrocart_localspace_additive: value })}>{t("quickopt.localSpaceOverAcg")}</CheckItem>
          <CheckItem checked={d.usetradfixstarnamespdlist} disabled={busy} onChange={(value) => patchDisplay({ usetradfixstarnamespdlist: value })}>{t("quickopt.traditionalFixedStarNamesInPdLists")}</CheckItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={busy}>{t("quickopt.themePresets")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-52 rounded-[5px]">
          {opts.themePresets.map((preset) => (
            <DropdownMenuItem key={preset.name} disabled={busy} onClick={() => applyPreset(preset.name)}>
              <span className="min-w-0 flex-1 truncate">{preset.label ?? preset.name}</span>
              {preset.selected ? <span className="ml-auto text-xs text-muted-foreground">{t("quickopt.on")}</span> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <CheckItem checked={opts.colors.follow_os_theme} disabled={busy} onChange={(value) => applyPatch({ colors: { follow_os_theme: value } })}>{t("quickopt.followOsTheme")}</CheckItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={busy} onClick={() => onOpenSettings?.("appearance")}>{t("quickopt.openFullSettings")}</DropdownMenuItem>
    </>
  );
}

function CheckItem({
  checked,
  disabled,
  inset = false,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  inset?: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      disabled={disabled}
      className={inset ? "pl-7" : undefined}
      onCheckedChange={(value) => onChange(Boolean(value))}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuCheckboxItem>
  );
}

function RadioSubmenu({
  label,
  value,
  choices,
  disabled,
  onValueChange,
}: {
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56 rounded-[5px]">
        <RadioGroupItems
          value={value}
          choices={choices}
          disabled={disabled}
          onValueChange={onValueChange}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function RadioNested({
  label,
  value,
  choices,
  disabled,
  onValueChange,
}: {
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56 rounded-[5px]">
        <RadioGroupItems
          value={value}
          choices={choices}
          disabled={disabled}
          onValueChange={onValueChange}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function RadioGroupItems({
  value,
  choices,
  disabled,
  onValueChange,
}: {
  value: string;
  choices: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
      {choices.map((choice) => (
        <DropdownMenuRadioItem key={choice.value} value={choice.value} disabled={disabled}>
          <span className="min-w-0 flex-1 truncate">{choice.label}</span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function SymbolRadio({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean | number;
  choices: Array<{ value: boolean | number; glyph: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-32 rounded-[5px]">
        <DropdownMenuRadioGroup value={symbolValue(value)} onValueChange={onChange}>
          {choices.map((choice) => (
            <DropdownMenuRadioItem
              key={symbolValue(choice.value)}
              value={symbolValue(choice.value)}
              disabled={disabled}
            >
              <Glyph ch={choice.glyph} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function symbolValue(value: boolean | number): string {
  return typeof value === "boolean" ? String(value) : String(value);
}

function Glyph({ ch }: { ch: string }) {
  return (
    <span
      style={{ fontFamily: "AriesMorinus" }}
      className="inline-block w-4 text-center text-[13px] text-foreground/70"
      aria-hidden
    >
      {ch}
    </span>
  );
}
