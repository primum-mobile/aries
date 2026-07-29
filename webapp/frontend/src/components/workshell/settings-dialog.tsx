"use client";

import * as React from "react";

import { ArrowDown, ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createAstrocartStyleMessage } from "@/lib/chart/astrocart-style";
import {
  applyThemePreset,
  daemonBaseUrl,
  daemonFetch,
  exportArabicParts,
  fetchOptions,
  importArabicParts,
  patchOptions,
  previewArabicPart,
  resolvePlace,
  setDefaultLocationFromMap,
  type ArabicPartMeta,
  type ArabicPartSpec,
  type ArabicRefSlot,
  type ColorFieldMeta,
  type DefaultLocationFieldMeta,
  type FixedStarCatalogRow,
  type OptionsAlmutens,
  type OptionsDefaultLocation,
  type OptionsDisplay,
  type OptionsPayload,
  type OptionsPatch,
  type OptionsPlanetsPoints,
  type OptionsQuickCharts,
  type OptionsRevolutions,
  type OptionsSymbols,
  type PlaceCandidate,
  type RGB,
} from "@/lib/daemon/client";
import { PrimDirSettingsBody, PD_PLANET_GLYPHS } from "./primdir-settings";
import { useAstrocartMapUrl } from "@/hooks/use-astrocart-map-url";
import { downloadText } from "./generic-table-view";
import { useThemeStore } from "@/stores/theme-store";
import { useSyncLocale, useT } from "@/lib/i18n/i18n";
import { useFixedRowHeightAnchor, useListRowHeight } from "@/lib/list-tokens";

// ---------------------------------------------------------------------------
// Settings / Appearance surface — a thin skin over the daemon options catalog.
// The daemon owns enum catalogs, glyph chars, color fields, and validation;
// React owns the desktop grouping and wx-parity row order for the visible tabs.
// Driven by GET/POST /api/options + POST /api/options/theme.
// ---------------------------------------------------------------------------

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTabId;
  onOptionsPatched?: (next?: OptionsPayload) => void;
};

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "colors",
  onOptionsPatched,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="workspace" motion="none" className="grid gap-0 overflow-hidden p-0">
        {open ? (
          <SettingsBody
            key={initialTab}
            initialTab={initialTab}
            onOptionsPatched={onOptionsPatched}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const SUPPORTED_SETTINGS_TAB_IDS = [
  "appearance", "astrocartography", "colors", "export", "houses", "ayanamsha",
  "location", "planets", "symbols", "orbs", "dignities", "speculum", "fixstars",
  "mansions", "almutens", "primarydirections", "revolutions", "supplementary",
  "timelords", "eclipses", "relationship", "stepalerts", "languages",
] as const;

export type SettingsTabId = (typeof SUPPORTED_SETTINGS_TAB_IDS)[number];

const SUPPORTED_SETTINGS_TABS = new Set<string>(SUPPORTED_SETTINGS_TAB_IDS);

export function isSettingsTabId(value: string): value is SettingsTabId {
  return SUPPORTED_SETTINGS_TABS.has(value);
}

function SettingsBody({
  initialTab,
  onOptionsPatched,
}: {
  initialTab: SettingsTabId;
  onOptionsPatched?: (next?: OptionsPayload) => void;
}) {
  const t = useT();
  const [opts, setOpts] = React.useState<OptionsPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const applyThemeState = useThemeStore((state) => state.applyThemeState);
  const syncLocale = useSyncLocale();
  const tabs = opts?.settingsRegistry.tabs.filter((tab) => isSettingsTabId(tab.id)) ?? [];
  const applyOptionsPayload = React.useCallback((next: OptionsPayload) => {
    setOpts(next);
    applyThemeState(next.themeState);
    syncLocale(next.languages.langid);
  }, [applyThemeState, syncLocale]);

  // Fetched once on mount — the dialog remounts this body on every open via the
  // `{open ? <SettingsBody/> : null}` gate, so fetch state starts fresh.
  React.useEffect(() => {
    const controller = new AbortController();
    fetchOptions(controller.signal)
      .then(applyOptionsPayload)
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(String(err));
      });
    return () => controller.abort();
  }, [applyOptionsPayload]);

  // Optimistic grouped patch: apply locally, fire the POST, reconcile from the
  // server result (or roll back on failure). The daemon re-renders open charts.
  const sendPatch = React.useCallback((patch: OptionsPatch, optimistic: OptionsPayload) => {
    setOpts(optimistic);
    patchOptions(patch)
      .then((next) => {
        applyOptionsPayload(next);
        onOptionsPatched?.(next);
      })
      .catch((err) => {
        console.error("[options-patch]", err);
        // Re-pull authoritative state so the UI doesn't desync on error.
        fetchOptions().then(applyOptionsPayload).catch(() => undefined);
      });
  }, [applyOptionsPayload, onOptionsPatched]);

  const applyPreset = React.useCallback((name: string) => {
    applyThemePreset(name)
      .then((next) => {
        applyOptionsPayload(next);
        onOptionsPatched?.(next);
      })
      .catch((err) => console.error("[theme-preset]", err));
  }, [applyOptionsPayload, onOptionsPatched]);

  if (error) {
    return (
      <div className="px-[var(--aries-dialog-padding)] py-[var(--aries-section-gap)] text-center text-[length:var(--aries-font-size-base)] text-foreground/70">
        {t("settings.loadFailed")}: {error}
      </div>
    );
  }

  return (
    <>
      <DialogHeader className="border-b border-border/40 px-[var(--aries-dialog-padding)] pb-[var(--aries-pane-header-padding-y)] pt-[var(--aries-dialog-padding)]">
        <DialogTitle className="text-[length:var(--aries-font-size-large)] font-medium tracking-tight">{t("settings.title")}</DialogTitle>
      </DialogHeader>
      {opts === null ? (
        <div className="px-[var(--aries-dialog-padding)] py-[calc(var(--aries-section-gap)*2)] text-center text-[length:var(--aries-font-size-base)] text-foreground/55">{t("settings.loading")}</div>
      ) : (
        <Tabs defaultValue={initialTab} orientation="vertical" className="gap-[var(--aries-tabs-rail-gap)]">
          <TabsList
            variant="line"
            className="w-[var(--aries-tabs-rail-width)] shrink-0 items-stretch gap-[var(--aries-tabs-rail-gap)] border-r border-border/40 bg-transparent p-[var(--aries-tabs-rail-padding)]"
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="justify-start rounded-md px-[var(--aries-tabs-rail-trigger-padding-x)] py-[var(--aries-tabs-rail-trigger-padding-y)] text-[length:var(--aries-font-size-base)] text-foreground/60 data-[selected]:bg-muted data-[selected]:text-foreground"
              >
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-w-0 flex-1 overflow-y-auto" style={{ maxHeight: "var(--aries-dialog-content-height-workspace)" }}>
            <TabsContent value="colors" className="m-0 p-[var(--aries-dialog-padding)]">
              <ColorsTab
                opts={opts}
                sendPatch={sendPatch}
                applyPreset={applyPreset}
              />
            </TabsContent>
            <TabsContent value="appearance" className="m-0 p-[var(--aries-dialog-padding)]">
              <AppearanceTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="astrocartography" className="m-0 p-[var(--aries-dialog-padding)]">
              <MirroredSettingsTab tabId="astrocartography" opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="export" className="m-0 p-[var(--aries-dialog-padding)]">
              <ExportTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="mansions" className="m-0 p-[var(--aries-dialog-padding)]">
              <LunarMansionsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="speculum" className="m-0 p-[var(--aries-dialog-padding)]">
              <SpeculumTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="houses" className="m-0 p-[var(--aries-dialog-padding)]">
              <HouseSystemTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="ayanamsha" className="m-0 p-[var(--aries-dialog-padding)]">
              <AyanamshaTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="orbs" className="m-0 p-[var(--aries-dialog-padding)]">
              <OrbsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="dignities" className="m-0 p-[var(--aries-dialog-padding)]">
              <DignitiesTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="symbols" className="m-0 p-[var(--aries-dialog-padding)]">
              <SymbolsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="planets" className="m-0 p-[var(--aries-dialog-padding)]">
              <PlanetsPointsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="location" className="m-0 p-[var(--aries-dialog-padding)]">
              <DefaultLocationTab
                opts={opts}
                sendPatch={sendPatch}
                onDefaultLocationApplied={(group) => {
                  // The map write happened on the daemon (outside the tab's
                  // optimistic patch); reconcile local state from the returned
                  // group so the fields update without a full refetch.
                  setOpts((cur) => (cur ? { ...cur, defaultLocation: group } : cur));
                  onOptionsPatched?.();
                }}
              />
            </TabsContent>
            <TabsContent value="revolutions" className="m-0 p-[var(--aries-dialog-padding)]">
              <RevolutionsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="supplementary" className="m-0 p-[var(--aries-dialog-padding)]">
              <ProgressionsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="stepalerts" className="m-0 p-[var(--aries-dialog-padding)]">
              <StepAlertsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="almutens" className="m-0 p-[var(--aries-dialog-padding)]">
              <AlmutensTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="timelords" className="m-0 p-[var(--aries-dialog-padding)]">
              <TimeLordsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="primarydirections" className="m-0 p-[var(--aries-dialog-padding)]">
              <PrimaryDirectionsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="eclipses" className="m-0 p-[var(--aries-dialog-padding)]">
              <EclipsesTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="fixstars" className="m-0 p-[var(--aries-dialog-padding)]">
              <FixedStarsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="relationship" className="m-0 p-[var(--aries-dialog-padding)]">
              <RelationshipChartsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="languages" className="m-0 p-[var(--aries-dialog-padding)]">
              <LanguagesTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives — dense, hairline, 10px section labels.
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-[var(--aries-control-gap)] mt-[var(--aries-section-gap)] text-[length:var(--aries-font-size-section)] font-medium text-foreground/45 first:mt-0">
      {children}
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-[var(--aries-control-height-small)] items-center justify-between gap-[var(--aries-form-row-gap)] border-b border-border/40 last:border-b-0">
      <span className="truncate text-[length:var(--aries-font-size-base)] text-foreground/80">{label}</span>
      <span className="flex shrink-0 items-center">{children}</span>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <span className="pl-[var(--aries-panel-padding-x)] text-foreground/70">{children}</span>;
}

function rgbToHex(rgb: RGB | null): string {
  if (!rgb) return "#000000";
  const [r, g, b] = rgb;
  return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex: string): RGB {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

/** Clean color swatch — a native <input type=color> masked behind a flat,
 * rounded swatch trigger so the picker UI is the platform one but the chrome is
 * ours. onCommit fires on change (debouncing is handled by optimistic patch). */
function Swatch({
  value,
  onCommit,
}: {
  value: RGB | null;
  onCommit: (rgb: RGB) => void;
}) {
  return (
    <label className="relative block h-[var(--aries-control-icon-size-default)] w-[var(--aries-control-height-small)] cursor-pointer overflow-hidden rounded-[var(--aries-radius-xs)] border border-border/60">
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ backgroundColor: `rgb(${(value ?? [0, 0, 0]).join(",")})` }}
      />
      <input
        type="color"
        value={rgbToHex(value)}
        onChange={(e) => onCommit(hexToRgb(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={
        "relative h-[var(--aries-control-icon-size-default)] w-[var(--aries-control-height-small)] rounded-[var(--aries-radius-ui-control)] transition-colors " +
        (disabled ? "opacity-40 " : "") +
        (checked ? "bg-foreground/80" : "bg-border")
      }
    >
      <span
        className={
          "absolute left-[calc(var(--aries-control-gap-compact)/2)] top-[calc(var(--aries-control-gap-compact)/2)] h-[var(--aries-control-icon-size-xs)] w-[var(--aries-control-icon-size-xs)] rounded-[var(--aries-radius-ui-control)] bg-background transition-all " +
          (checked ? "translate-x-[var(--aries-control-icon-size-xs)]" : "translate-x-0")
        }
      />
    </button>
  );
}

/** Uncontrolled numeric field, committed on blur. Keyed by `value` upstream so a
 * server-driven value change remounts it with the fresh defaultValue — avoids a
 * setState-in-effect sync (react-hooks/set-state-in-effect). */
function NumberField({
  value,
  step = 1,
  min,
  max,
  onCommit,
}: {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
}) {
  return (
    <input
      data-aries-control-appearance="local"
      key={value}
      type="number"
      step={step}
      min={min}
      max={max}
      defaultValue={value}
      onBlur={(e) => {
        let n = Number(e.target.value);
        if (Number.isFinite(n)) {
          if (typeof min === "number") n = Math.max(min, n);
          if (typeof max === "number") n = Math.min(max, n);
        }
        if (Number.isFinite(n) && n !== value) onCommit(n);
        else e.target.value = String(value);
      }}
      className="h-[var(--aries-control-height-micro)] w-[52px] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap-compact)] text-right text-[length:var(--aries-font-size-base)] tabular-nums outline-none focus:border-border"
    />
  );
}

function Select({
  value,
  onChange,
  children,
  width = 180,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <select
      data-aries-control-appearance="local"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width }}
      className="h-[var(--aries-control-height-compact)] rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
    >
      {children}
    </select>
  );
}

function Glyph({ ch }: { ch: string }) {
  return (
    <span className="font-symbols inline-block w-[var(--aries-control-icon-size-default)] text-center text-[length:var(--aries-font-size-reading)] text-foreground/70">
      {ch}
    </span>
  );
}

/** Generic numeric slider rendered from catalog SliderFieldMeta. Commits on
 * release (onMouseUp/onKeyUp + change), showing the live value alongside. */
function Slider({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (n: number) => void;
}) {
  const [local, setLocal] = React.useState(value);
  return (
    <span className="flex items-center gap-[var(--aries-form-field-gap)]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => {
          if (local !== value) onCommit(local);
        }}
        onKeyUp={() => {
          if (local !== value) onCommit(local);
        }}
        className="h-1 w-[120px] cursor-pointer accent-foreground/70"
      />
      <span className="w-9 text-right text-[length:var(--aries-font-size-small)] tabular-nums text-foreground/55">
        {step < 1 ? local.toFixed(2) : local}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Colors  (colorsdlg.ColorsDlg: preset + 4 notebook pages)
// ---------------------------------------------------------------------------

type TabProps = {
  opts: OptionsPayload;
  sendPatch: (patch: OptionsPatch, optimistic: OptionsPayload) => void;
};

function MirroredSettingsTab({
  tabId,
  opts,
  sendPatch,
}: TabProps & { tabId: SettingsTabId }) {
  const t = useT();
  const section = opts.settingsRegistry.mirroredSections.find((item) => item.tabId === tabId);
  if (!section) return null;

  return (
    <>
      <SectionLabel>{t(section.labelKey)}</SectionLabel>
      {section.settings.map((setting) => (
        <Row key={setting.id} label={t(setting.labelKey)}>
          <Toggle
            checked={Boolean(opts.display[setting.field])}
            onChange={(value) => {
              const displayPatch = { [setting.field]: value } as Partial<OptionsDisplay>;
              sendPatch(
                { display: displayPatch },
                { ...opts, display: { ...opts.display, ...displayPatch } },
              );
            }}
          />
        </Row>
      ))}
    </>
  );
}

function ExportTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const e = opts.export;
  const setPatch = (patch: Partial<OptionsPayload["export"]>) => {
    sendPatch({ export: patch }, { ...opts, export: { ...e, ...patch } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.pngCopy")}</SectionLabel>
      <Row label={t("settings.pngAppearance")}>
        <Select
          value={e.pngChartAppearance}
          width={190}
          onChange={(value) => setPatch({ pngChartAppearance: value as OptionsPayload["export"]["pngChartAppearance"] })}
        >
          {e.pngChartAppearanceChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {t(choice.labelKey)}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.includeOverlays")}>
        <Toggle checked={e.pngIncludeOverlays} onChange={(value) => setPatch({ pngIncludeOverlays: value })} />
      </Row>
      <Row label={t("settings.pngFormat")}>
        <span className="text-[length:var(--aries-font-size-base)] text-foreground/55">
          {t("settings.pngSquare")}
        </span>
      </Row>
      <SectionLabel>{t("settings.pdf")}</SectionLabel>
      <Row label={t("settings.chartColors")}>
        <Select
          value={e.pdfChartColorMode}
          width={190}
          onChange={(value) => setPatch({ pdfChartColorMode: value as OptionsPayload["export"]["pdfChartColorMode"] })}
        >
          {e.pdfChartColorModeChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.pdfRasterPreset")}>
        <Select
          value={e.pdfChartRasterPreset}
          width={190}
          onChange={(value) => setPatch({ pdfChartRasterPreset: value as OptionsPayload["export"]["pdfChartRasterPreset"] })}
        >
          {e.pdfChartRasterPresetChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {t(choice.labelKey)}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.includeOverlays")}>
        <Toggle checked={e.pdfIncludeOverlays} onChange={(value) => setPatch({ pdfIncludeOverlays: value })} />
      </Row>
      <SectionLabel>{t("settings.listExports")}</SectionLabel>
      <Row label={t("settings.showAspectSymbolsInListExports")}>
        <Toggle
          checked={e.listExportAspectSymbols}
          onChange={(value) => setPatch({ listExportAspectSymbols: value })}
        />
      </Row>
    </div>
  );
}

// Section title per colour group — the only presentation glue between the
// daemon `group` enum and a heading. Not an option catalog (no field/label/enum
// data); the daemon owns which attrs land in each group.
const COLOR_GROUP_TITLE_KEYS: Record<ColorFieldMeta["group"], string> = {
  chart: "settings.colorGroupChart",
  element: "settings.colorGroupElement",
  dignity: "settings.colorGroupDignity",
  chrome: "settings.colorGroupChrome",
};
const COLOR_GROUP_ORDER: ColorFieldMeta["group"][] = ["chart", "element", "dignity", "chrome"];

function ColorsTab({
  opts,
  sendPatch,
  applyPreset,
}: TabProps & { applyPreset: (name: string) => void }) {
  const t = useT();
  const c = opts.colors;
  const cat = opts.catalog;

  const setColor = (attr: keyof OptionsPayload["colors"], rgb: RGB) => {
    // These two existing rows historically styled both the Tauri shell and
    // charts. Keep that UI behavior while the independently persisted app
    // slots allow future profiles to edit either authority on its own.
    const paired = attr === "clrbackground"
      ? { clrbackground: rgb, clrappbackground: rgb }
      : attr === "clrtexts"
        ? { clrtexts: rgb, clrapptexts: rgb }
        : { [attr]: rgb };
    sendPatch(
      { colors: paired },
      { ...opts, colors: { ...c, ...paired } },
    );
  };
  const setListColor = (key: "clrindividual" | "clraspect", index: number, rgb: RGB) => {
    const next = [...(c[key] as (RGB | null)[])];
    next[index] = rgb;
    sendPatch({ colors: { [key]: next } }, { ...opts, colors: { ...c, [key]: next } });
  };
  const setBool = (attr: "useplanetcolors" | "usezodiacelementcolors" | "follow_os_theme", v: boolean) => {
    sendPatch({ colors: { [attr]: v } }, { ...opts, colors: { ...c, [attr]: v } });
  };

  // Group the daemon-provided colour fields by their `group` tag, preserving
  // daemon order within each group.
  const byGroup = (group: ColorFieldMeta["group"]) =>
    cat.colorFields.filter((f) => f.group === group);

  const rgbText = (rgb: RGB | null | undefined) =>
    rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : "";
  const hexText = (rgb: RGB | null | undefined) =>
    rgb ? `#${rgb.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}` : "";
  const appendRows = (lines: string[], section: string, rows: [string, RGB | null | undefined][]) => {
    rows.forEach(([name, rgb]) => {
      lines.push(`${section}\t${name}\t${hexText(rgb)}\t${rgbText(rgb)}`);
    });
  };
  const copyTable = () => {
    const lines = ["section\tname\thex\trgb"];
    for (const group of COLOR_GROUP_ORDER) {
      appendRows(
        lines,
        group === "element" ? "zodiac elements" : group,
        byGroup(group).map((f) => [f.label, c[f.attr] as RGB | null]),
      );
    }
    appendRows(
      lines,
      "bodies",
      cat.individualColors.map((p) => [p.label, c.clrindividual[p.index] ?? null]),
    );
    appendRows(
      lines,
      "aspects",
      cat.aspectLabels.map((label, i) => [label, c.clraspect[i] ?? null]),
    );
    lines.push(`flags\tUse individual colors\t${c.useplanetcolors ? "1" : "0"}\t`);
    lines.push(`flags\tUse zodiac element colors\t${c.usezodiacelementcolors ? "1" : "0"}\t`);
    void navigator.clipboard?.writeText(lines.join("\n")).catch((err) => {
      console.error("[copy-color-table]", err);
    });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.palettePreset")}</SectionLabel>
      <div className="flex flex-wrap gap-[var(--aries-control-gap)] pb-[var(--aries-segmented-control-padding)]">
        {opts.themePresets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => applyPreset(preset.name)}
            aria-pressed={Boolean(preset.selected)}
            className={`rounded-[var(--aries-radius-control-compact)] border px-[var(--aries-control-padding-x)] py-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-small)] hover:border-border hover:text-foreground ${
              preset.selected
                ? "border-foreground/35 bg-foreground/10 text-foreground"
                : "border-border/60 text-foreground/80"
            }`}
          >
            {preset.label ?? preset.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-[var(--aries-control-gap)] pb-[var(--aries-segmented-control-padding)]">
        <button
          type="button"
          onClick={copyTable}
          className="rounded-[var(--aries-radius-control-compact)] border border-border/60 px-[var(--aries-control-padding-x)] py-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-small)] text-foreground/80 hover:border-border hover:text-foreground"
        >
          {t("settings.copyTable")}
        </button>
      </div>
      <Row label={t("settings.followOsTheme")}>
        <Toggle checked={c.follow_os_theme} onChange={(v) => setBool("follow_os_theme", v)} />
      </Row>

      {COLOR_GROUP_ORDER.map((group) => {
        const fields = byGroup(group);
        if (fields.length === 0) return null;
        return (
          <React.Fragment key={group}>
            <SectionLabel>{t(COLOR_GROUP_TITLE_KEYS[group])}</SectionLabel>
            {group === "element" ? (
              <Row label={t("settings.useZodiacElementColors")}>
                <Toggle
                  checked={c.usezodiacelementcolors}
                  onChange={(v) => setBool("usezodiacelementcolors", v)}
                />
              </Row>
            ) : null}
            {fields.map((f) => (
              <Row key={f.attr} label={f.label}>
                <Swatch value={c[f.attr] as RGB | null} onCommit={(rgb) => setColor(f.attr, rgb)} />
              </Row>
            ))}
          </React.Fragment>
        );
      })}

      <SectionLabel>{t("settings.individualBodies")}</SectionLabel>
      <Row label={t("settings.useIndividualColors")}>
        <Toggle checked={c.useplanetcolors} onChange={(v) => setBool("useplanetcolors", v)} />
      </Row>
      {cat.individualColors.map((p) => (
        <Row
          key={p.index}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={p.glyph} />
              {p.label}
            </span>
          }
        >
          <Swatch
            value={c.clrindividual[p.index] ?? null}
            onCommit={(rgb) => setListColor("clrindividual", p.index, rgb)}
          />
        </Row>
      ))}

      <SectionLabel>{t("settings.aspects")}</SectionLabel>
      {cat.aspectLabels.map((label, i) => (
        <Row
          key={label}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={cat.aspectGlyphs[i] ?? ""} />
              {label}
            </span>
          }
        >
          <Swatch value={c.clraspect[i] ?? null} onCommit={(rgb) => setListColor("clraspect", i, rgb)} />
        </Row>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Appearance  (appearance1dlg subset the backend exposes)
// ---------------------------------------------------------------------------

const MINOR_ASPECT_INDICES = new Set([1, 2, 4, 7, 8, 9, 11]);

function AppearanceTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const d = opts.display;
  const aspectList = opts.aspectList;
  const q = opts.quickCharts;
  const cat = opts.catalog;
  type DisplayPatch = Partial<OptionsPayload["display"]>;
  type QuickChartsPatch = Partial<OptionsQuickCharts>;
  const setDisplayPatch = (patch: DisplayPatch) => {
    sendPatch({ display: patch }, { ...opts, display: { ...d, ...patch } });
  };
  const setAspectListPatch = (patch: Partial<OptionsPayload["aspectList"]>) => {
    sendPatch(
      { aspectList: patch },
      { ...opts, aspectList: { ...aspectList, ...patch } },
    );
  };
  const setQuickChartsPatch = (patch: QuickChartsPatch) => {
    sendPatch({ quickCharts: patch }, { ...opts, quickCharts: { ...q, ...patch } });
  };
  const setBool = (attr: keyof OptionsPayload["display"], v: boolean) => {
    setDisplayPatch({ [attr]: v } as DisplayPatch);
  };
  const setNum = (attr: keyof OptionsPayload["display"], n: number) => {
    setDisplayPatch({ [attr]: n } as DisplayPatch);
  };
  const setStr = (attr: keyof OptionsPayload["display"], s: string) => {
    setDisplayPatch({ [attr]: s } as DisplayPatch);
  };
  // Element-wise patch of a fixed-length bool vector (aspect[] / transcendental[]).
  const setVec = (attr: "aspect" | "transcendental", i: number, v: boolean) => {
    const next = [...d[attr]];
    next[i] = v;
    setDisplayPatch({
      [attr]: next,
      ...(attr === "aspect" && v && MINOR_ASPECT_INDICES.has(i)
        ? { traditionalaspects: false }
        : {}),
    } as DisplayPatch);
  };
  const setTraditionalAspects = (v: boolean) => {
    const patch: DisplayPatch = { traditionalaspects: v };
    if (v) {
      const nextAspect = [...d.aspect];
      for (const i of MINOR_ASPECT_INDICES) nextAspect[i] = false;
      patch.aspect = nextAspect;
    }
    setDisplayPatch(patch);
  };
  const setAspects = (v: boolean) => {
    setDisplayPatch({ aspects: v });
  };
  const setShownodes = (v: boolean) => {
    setDisplayPatch({ shownodes: v, ...(!v ? { aspectstonodes: false } : {}) });
  };
  const setShowvertex = (v: boolean) => {
    setDisplayPatch({ showvertex: v, ...(!v ? { showaspectstovertex: false } : {}) });
  };
  const setShowlof = (v: boolean) => {
    setDisplayPatch({
      showlof: v,
      ...(!v ? { showaspectstolof: false, showlofouterring: false } : {}),
    });
  };
  const setExclusiveAspects = (v: boolean) => {
    setDisplayPatch({
      exclusive_aspects_on_click: v,
      ...(!v
        ? {
            exclusive_aspects_on_click_show_minor: false,
            exclusive_aspects_on_click_traditional: false,
          }
        : {}),
    });
  };
  const setShowfixstars = (value: number) => {
    const patch: DisplayPatch = { showfixstars: value };
    if (![1, 6, 7, 8].includes(value)) {
      Object.assign(patch, {
        showfixstarsnodes: false,
        showfixstarshcs: false,
        showfixstarslof: false,
      });
    }
    setDisplayPatch(patch);
  };
  const setTerms = (v: boolean) => {
    sendPatch(
      { display: { showterms: v }, dignities: { showterms: v } },
      { ...opts, display: { ...d, showterms: v }, dignities: { ...opts.dignities, showterms: v } },
    );
  };
  const setDignityLabelColors = (v: boolean) => {
    sendPatch(
      { dignities: { dignitylabelcolors: v } },
      { ...opts, dignities: { ...opts.dignities, dignitylabelcolors: v } },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.aspects")}</SectionLabel>
      <Row label={t("settings.aspects")}>
        <Toggle checked={d.aspects} onChange={setAspects} />
      </Row>
      <Row label={t("settings.withSymbols")}>
        <Toggle checked={d.symbols} disabled={!d.aspects} onChange={(v) => setBool("symbols", v)} />
      </Row>
      <Row label={t("settings.traditional")}>
        <Toggle
          checked={d.traditionalaspects}
          disabled={!d.aspects}
          onChange={setTraditionalAspects}
        />
      </Row>
      {/* Per-aspect draw toggles — labels/glyphs reuse the catalog aspect list. */}
      {cat.aspectLabels.map((label, i) => (
        <Row
          key={label}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={cat.aspectGlyphs[i] ?? ""} />
              {label}
            </span>
          }
        >
          <Toggle
            checked={Boolean(d.aspect[i])}
            disabled={!d.aspects || (d.traditionalaspects && MINOR_ASPECT_INDICES.has(i))}
            onChange={(v) => setVec("aspect", i, v)}
          />
        </Row>
      ))}
      <Row label={t("settings.aspectsToAngles")}>
        <span />
      </Row>
      <Row label={<SubLabel>{t("primdir.angleAsc")}</SubLabel>}>
        <Toggle
          checked={d.showaspectstoasc}
          disabled={!d.aspects}
          onChange={(v) => setBool("showaspectstoasc", v)}
        />
      </Row>
      <Row label={<SubLabel>{t("primdir.angleMC")}</SubLabel>}>
        <Toggle
          checked={d.showaspectstomc}
          disabled={!d.aspects}
          onChange={(v) => setBool("showaspectstomc", v)}
        />
      </Row>
      <Row label={<SubLabel>{t("primdir.angleDsc")}</SubLabel>}>
        <Toggle
          checked={d.showaspectstodsc}
          disabled={!d.aspects}
          onChange={(v) => setBool("showaspectstodsc", v)}
        />
      </Row>
      <Row label={<SubLabel>{t("primdir.angleIC")}</SubLabel>}>
        <Toggle
          checked={d.showaspectstoic}
          disabled={!d.aspects}
          onChange={(v) => setBool("showaspectstoic", v)}
        />
      </Row>
      {/* Aspect behaviour toggles (appearance1dlg.py). The exclusive-on-click subs
          are gated on their master (and the master on `aspects`) — mirrors
          _sync_dependent_aspect_toggles (appearance1dlg.py:726-730). */}
      <Row label={t("settings.exclusiveAspectsOnClick")}>
        <Toggle
          checked={d.exclusive_aspects_on_click}
          disabled={!d.aspects}
          onChange={setExclusiveAspects}
        />
      </Row>
      <Row label={<SubLabel>{t("settings.showMinor")}</SubLabel>}>
        <Toggle
          checked={d.exclusive_aspects_on_click_show_minor}
          disabled={
            !d.aspects ||
            !d.exclusive_aspects_on_click ||
            d.exclusive_aspects_on_click_traditional
          }
          onChange={(v) =>
            setDisplayPatch({
              exclusive_aspects_on_click_show_minor: v,
              ...(v ? { exclusive_aspects_on_click_traditional: false } : {}),
            })
          }
        />
      </Row>
      <Row label={<SubLabel>{t("settings.traditional")}</SubLabel>}>
        <Toggle
          checked={d.exclusive_aspects_on_click_traditional}
          disabled={!d.aspects || !d.exclusive_aspects_on_click}
          onChange={(v) =>
            setDisplayPatch({
              exclusive_aspects_on_click_traditional: v,
              ...(v ? { exclusive_aspects_on_click_show_minor: false } : {}),
            })
          }
        />
      </Row>
      <Row label={t("settings.aspectDrawingStandard")}>
        <Toggle
          checked={!d.aspect_thickness_mode && !d.aspect_opacity_mode}
          disabled={!d.aspects}
          onChange={(v) => v && setDisplayPatch({ aspect_thickness_mode: false, aspect_opacity_mode: false })}
        />
      </Row>
      <Row label={<SubLabel>{t("settings.aspectDrawingLineThickness")}</SubLabel>}>
        <Toggle
          checked={d.aspect_thickness_mode}
          disabled={!d.aspects}
          onChange={(v) => setBool("aspect_thickness_mode", v)}
        />
      </Row>
      <Row label={<SubLabel>{t("settings.aspectDrawingOpacity")}</SubLabel>}>
        <Toggle
          checked={d.aspect_opacity_mode}
          disabled={!d.aspects}
          onChange={(v) => setBool("aspect_opacity_mode", v)}
        />
      </Row>
      <Row label={t("settings.showPlanetsInAspectHoverFlag")}>
        <Toggle
          checked={d.aspect_flag_show_parties}
          disabled={!d.aspects}
          onChange={(v) => setBool("aspect_flag_show_parties", v)}
        />
      </Row>

      <SectionLabel>{t("settings.bodiesAndPoints")}</SectionLabel>
      {/* Transcendental U/N/P — labels/glyphs from the catalog. */}
      {cat.transcendentalLabels.map((item, i) => (
        <Row
          key={item.label}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={item.glyph} />
              {item.label}
            </span>
          }
        >
          <Toggle
            checked={Boolean(d.transcendental[i])}
            onChange={(v) => setVec("transcendental", i, v)}
          />
        </Row>
      ))}
      <Row label={t("settings.chiron")}>
        <Toggle checked={d.showchiron} onChange={(v) => setBool("showchiron", v)} />
      </Row>
      <Row label={t("settings.vertex")}>
        <Toggle checked={d.showvertex} onChange={setShowvertex} />
      </Row>
      <Row label={<SubLabel>{t("settings.aspectsToVertex")}</SubLabel>}>
        <Toggle
          checked={d.aspects && d.showvertex && d.showaspectstovertex}
          disabled={!d.aspects || !d.showvertex}
          onChange={(v) => setBool("showaspectstovertex", v)}
        />
      </Row>
      <Row label={t("settings.nodes")}>
        <Toggle checked={d.shownodes} onChange={setShownodes} />
      </Row>
      <Row label={<SubLabel>{t("settings.aspectsToNodes")}</SubLabel>}>
        <Toggle
          checked={d.aspects && d.shownodes && d.aspectstonodes}
          disabled={!d.aspects || !d.shownodes}
          onChange={(v) => setBool("aspectstonodes", v)}
        />
      </Row>
      <Row label={t("settings.fortuna")}>
        <Toggle checked={d.showlof} onChange={setShowlof} />
      </Row>
      <Row label={<SubLabel>{t("settings.aspectsToFortuna")}</SubLabel>}>
        <Toggle
          checked={d.aspects && d.showlof && d.showaspectstolof}
          disabled={!d.aspects || !d.showlof}
          onChange={(v) => setBool("showaspectstolof", v)}
        />
      </Row>
      <Row label={<SubLabel>{t("settings.outerRingFortunaLabel")}</SubLabel>}>
        <Toggle
          checked={d.showlof && d.showlofouterring}
          disabled={!d.showlof}
          onChange={(v) => setBool("showlofouterring", v)}
        />
      </Row>
      <Row label={t("settings.prenatalSyzygy")}>
        <Toggle checked={d.showprenatalsyzygy} onChange={(v) => setBool("showprenatalsyzygy", v)} />
      </Row>
      <Row label={t("settings.houses")}>
        <Toggle checked={d.houses} onChange={(v) => setBool("houses", v)} />
      </Row>
      <Row label={<SubLabel>{t("settings.outerHouseLines")}</SubLabel>}>
        <Toggle
          checked={d.houses && d.showouterhouselines}
          disabled={!d.houses}
          onChange={(v) => setBool("showouterhouselines", v)}
        />
      </Row>
      <Row label={t("settings.inTables")}>
        <Toggle checked={d.intables} onChange={(v) => setBool("intables", v)} />
      </Row>
      <Row label={t("settings.speculum")}>
        <Toggle checked={d.positions} onChange={(v) => setBool("positions", v)} />
      </Row>
      <Row label={t("settings.terms")}>
        <Toggle checked={d.showterms} onChange={setTerms} />
      </Row>
      <Row label={t("settings.decans")}>
        <Toggle checked={d.showdecans} onChange={(v) => setBool("showdecans", v)} />
      </Row>
      <Row label={t("settings.colorDignityLabelsFromGlyph")}>
        <Toggle checked={opts.dignities.dignitylabelcolors} onChange={setDignityLabelColors} />
      </Row>
      <Row label={t("settings.topocentricMoon")}>
        <Toggle checked={d.topocentric} onChange={(v) => setBool("topocentric", v)} />
      </Row>

      <SectionLabel>{t("settings.outerRing")}</SectionLabel>
      <Row label={t("settings.mode")}>
        <Select
          value={d.showfixstars}
          width={150}
          onChange={(v) => setShowfixstars(Number(v))}
        >
          {opts.catalog.fixstarsModes.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </Select>
      </Row>
      {/* FixStars conjunction sub-toggles. enableSubFixstars (appearance1dlg.py:796)
          is on for FixStars(1)/Asteroids(6)/Midpoints(7)/HybridHits(8); gate the
          subs to those modes. */}
      {(() => {
        const subsEnabled = [1, 6, 7, 8].includes(d.showfixstars);
        return (
          <>
            <Row label={<SubLabel>{t("settings.nodes")}</SubLabel>}>
              <Toggle
                checked={d.showfixstarsnodes}
                disabled={!subsEnabled}
                onChange={(v) => setBool("showfixstarsnodes", v)}
              />
            </Row>
            <Row label={<SubLabel>{t("settings.intermHcs")}</SubLabel>}>
              <Toggle
                checked={d.showfixstarshcs}
                disabled={!subsEnabled}
                onChange={(v) => setBool("showfixstarshcs", v)}
              />
            </Row>
            <Row label={<SubLabel>{t("settings.fortuna")}</SubLabel>}>
              <Toggle
                checked={d.showfixstarslof}
                disabled={!subsEnabled}
                onChange={(v) => setBool("showfixstarslof", v)}
              />
            </Row>
          </>
        );
      })()}
      <Row label={t("settings.morinAntiscia")}>
        <Toggle checked={d.morin_antiscia} onChange={(v) => setBool("morin_antiscia", v)} />
      </Row>

      <SectionLabel>{t("settings.chartLayout")}</SectionLabel>
      <Row label={t("settings.subChartsAsBiwheels")}>
        <Toggle
          checked={q.subcharts_open_compound_default}
          onChange={(v) => setQuickChartsPatch({ subcharts_open_compound_default: v })}
        />
      </Row>
      <Row label={t("settings.wheelLayout")}>
        <Select
          value={d.theme}
          width={150}
          onChange={(v) => setNum("theme", Number(v))}
        >
          {cat.themeLayouts.map((layout) => (
            <option key={layout.value} value={layout.value}>
              {layout.label}
            </option>
          ))}
        </Select>
      </Row>
      {d.theme === 2 ? (
        <Row label={t("settings.angloDenseLabelLayout")}>
          <Select
            value={d.anglo_dense_label_layout}
            width={180}
            onChange={(v) => setStr("anglo_dense_label_layout", v)}
          >
            {cat.angloDenseLabelLayouts.map((layout) => (
              <option key={layout.value} value={layout.value}>
                {layout.value === "routed-cusps"
                  ? t("settings.routedCuspLines")
                  : t("settings.leaderColumns")}
              </option>
            ))}
          </Select>
        </Row>
      ) : null}
      <Row label={t("settings.angleArrowheads")}>
        <Toggle
          checked={d.showanglearrowheads}
          onChange={(v) => setBool("showanglearrowheads", v)}
        />
      </Row>
      <Row label={t("settings.cusplessAscMcLabels")}>
        <Toggle
          checked={d.showcusplessascmclabels}
          onChange={(v) => setBool("showcusplessascmclabels", v)}
        />
      </Row>

      <SectionLabel>{t("settings.sizes")}</SectionLabel>
      {/* Numeric sliders rendered generically from catalog.sliders. */}
      {cat.sliders.map((s) => (
        <Row key={s.attr} label={s.label}>
          <Slider
            key={`${s.attr}:${Number(d[s.attr] ?? s.min)}`}
            value={Number(d[s.attr] ?? s.min)}
            min={s.min}
            max={s.max}
            step={s.step}
            onCommit={(n) => setNum(s.attr, s.kind === "int" ? Math.round(n) : n)}
          />
        </Row>
      ))}

      <SectionLabel>{t("settings.chartHeader")}</SectionLabel>
      <Row label={t("settings.planetaryHour")}>
        <Toggle checked={d.planetarydayhour} onChange={(v) => setBool("planetarydayhour", v)} />
      </Row>
      <Row label={t("settings.housesystem")}>
        <Toggle checked={d.housesystem} onChange={(v) => setBool("housesystem", v)} />
      </Row>
      <Row label={t("settings.information")}>
        <Toggle checked={d.information} onChange={(v) => setBool("information", v)} />
      </Row>
      <Row label={t("settings.showSecondsInHeader")}>
        <Toggle checked={d.showseconds} onChange={(v) => setBool("showseconds", v)} />
      </Row>
      <Row label={t("settings.dateFormat")}>
        <Select
          value={d.dateconvention}
          width={170}
          onChange={(v) => setStr("dateconvention", v)}
        >
          {cat.dateConventions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>

      <SectionLabel>{t("settings.phasisHeliacal")}</SectionLabel>
      <Row label={t("settings.mode")}>
        <Select
          value={d.phasismode}
          width={150}
          onChange={(v) => setNum("phasismode", Number(v))}
        >
          {cat.phasisModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.modernPlanets")}>
        <Toggle checked={d.extendedradixstations} onChange={(v) => setBool("extendedradixstations", v)} />
      </Row>

      <SectionLabel>{t("settings.cazimi")}</SectionLabel>
      <Row label={t("settings.display")}>
        <Toggle checked={d.showcazimi} onChange={(v) => setBool("showcazimi", v)} />
      </Row>
      <Row label={t("settings.mode")}>
        <Select
          value={d.cazimimode}
          width={150}
          onChange={(v) => setNum("cazimimode", Number(v))}
        >
          {cat.cazimiModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>

      <SectionLabel>{t("settings.synodic")}</SectionLabel>
      <Row label={t("settings.shiftArrow")}>
        <Select
          value={d.synodicmode}
          width={150}
          onChange={(v) => setNum("synodicmode", Number(v))}
        >
          {cat.synodicModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>

      <SectionLabel>{t("settings.eclipses")}</SectionLabel>
      <Row label={t("settings.eclipseOverlay")}>
        <Toggle checked={d.showeclipseoverlay} onChange={(v) => setBool("showeclipseoverlay", v)} />
      </Row>

      <SectionLabel>{t("settings.display")}</SectionLabel>
      {cat.fontProfiles.length > 0 ? (
        <Row label={t("settings.typeface")}>
          <Select
            value={d.fontfamily}
            width={160}
            onChange={(v) => setStr("fontfamily", v)}
          >
            {cat.fontProfiles.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Row>
      ) : null}
      <Row label={t("settings.showTradFixStarNamesPdLists")}>
        <Toggle
          checked={d.usetradfixstarnamespdlist}
          onChange={(v) => setBool("usetradfixstarnamespdlist", v)}
        />
      </Row>
      <Row label={t("settings.showChartNavigationBar")}>
        <Toggle checked={d.show_help_chip} onChange={(v) => setBool("show_help_chip", v)} />
      </Row>

      <SectionLabel>{t("aspectList.title")}</SectionLabel>
      <Row label={t("settings.showAspectsForDerivedPoints")}>
        <Toggle
          checked={aspectList.showAspectsForDerivedPoints}
          onChange={(v) => setAspectListPatch({ showAspectsForDerivedPoints: v })}
        />
      </Row>
    </div>
  );
}

function LunarMansionsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.lunarMansions")}</SectionLabel>
      <Row label={t("settings.zodiacForManazil")}>
        <Select
          value={opts.lunarMansions.manazil_zodiac}
          width={180}
          onChange={(v) =>
            sendPatch(
              { lunarMansions: { manazil_zodiac: v } },
              { ...opts, lunarMansions: { ...opts.lunarMansions, manazil_zodiac: v } },
            )
          }
        >
          {opts.catalog.mansionZodiacModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.showMansionInMoonInspector")}>
        <Toggle
          checked={opts.lunarMansions.show_manzil_in_inspector}
          onChange={(v) =>
            sendPatch(
              { lunarMansions: { show_manzil_in_inspector: v } },
              {
                ...opts,
                lunarMansions: { ...opts.lunarMansions, show_manzil_in_inspector: v },
              },
            )
          }
        />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Speculum  (appearance2dlg.Appearance2Dlg) — Placidian + Regiomontanus speculum
// column-visibility toggles + the In-Time control. The daemon owns WHICH columns
// exist + their labels (catalog.speculum*Cols, keyed by the planets.Planet column
// index); this tab renders one toggle per column and patches the bool map. NOTE:
// the speculum TABLE WINDOW these flags drive is not yet ported to the webapp —
// this is the settings surface only (see settings.md / appearance-menu.md §7.2).
// ---------------------------------------------------------------------------

function SpeculumTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const s = opts.speculum;
  const cat = opts.catalog;

  const setCol = (row: "placidian" | "regiomontan", idx: number, v: boolean) => {
    const nextRow = { ...s[row], [String(idx)]: v };
    sendPatch(
      { speculum: { [row]: nextRow } },
      { ...opts, speculum: { ...s, [row]: nextRow } },
    );
  };
  const setFlag = (attr: "placidianDodec" | "regiomontanDodec" | "intime", v: boolean) => {
    sendPatch({ speculum: { [attr]: v } }, { ...opts, speculum: { ...s, [attr]: v } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.placidianColumns")}</SectionLabel>
      {cat.speculumPlacidianCols.map((c) => (
        <Row key={c.idx} label={c.label}>
          <Toggle
            checked={Boolean(s.placidian[String(c.idx)])}
            onChange={(v) => setCol("placidian", c.idx, v)}
          />
        </Row>
      ))}
      <Row label={t("settings.dodecatemorion")}>
        <Toggle checked={s.placidianDodec} onChange={(v) => setFlag("placidianDodec", v)} />
      </Row>

      <SectionLabel>{t("settings.regiomontanusColumns")}</SectionLabel>
      {cat.speculumRegiomontanCols.map((c) => (
        <Row key={c.idx} label={c.label}>
          <Toggle
            checked={Boolean(s.regiomontan[String(c.idx)])}
            onChange={(v) => setCol("regiomontan", c.idx, v)}
          />
        </Row>
      ))}
      <Row label={t("settings.dodecatemorion")}>
        <Toggle checked={s.regiomontanDodec} onChange={(v) => setFlag("regiomontanDodec", v)} />
      </Row>

      <SectionLabel>{t("settings.rectascension")}</SectionLabel>
      <Row label={t("settings.inTime")}>
        <Toggle checked={s.intime} onChange={(v) => setFlag("intime", v)} />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — House System  (onHouseSystem: radio list over houses.Houses.hsystems)
// ---------------------------------------------------------------------------

function HouseSystemTab({ opts, sendPatch }: TabProps) {
  const hs = opts.houseSystem;
  const pick = (code: string) => {
    sendPatch(
      { houseSystem: { hsys: code } },
      { ...opts, houseSystem: { ...hs, hsys: code } },
    );
  };
  const t = useT();
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.houseSystem")}</SectionLabel>
      {hs.available.map((entry) => (
        <button
          key={entry.code}
          type="button"
          onClick={() => pick(entry.code)}
          className="flex h-[var(--aries-control-height-small)] items-center justify-between border-b border-border/40 text-left last:border-b-0"
        >
          <span className="text-[length:var(--aries-font-size-base)] text-foreground/85">{entry.label}</span>
          <span
            className={
              "flex h-3.5 w-3.5 items-center justify-center rounded-full border " +
              (hs.hsys === entry.code ? "border-foreground/80" : "border-border")
            }
          >
            {hs.hsys === entry.code ? <span className="h-1.5 w-1.5 rounded-full bg-foreground/80" /> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4 — Ayanamsha  (onAyanamshaPick: radio over mtexts.ayanamshalist)
// ---------------------------------------------------------------------------

function AyanamshaTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const a = opts.ayanamsha;
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.ayanamsha")}</SectionLabel>
      <Row label={t("settings.mode")}>
        <Select
          value={a.ayanamsha}
          width={220}
          onChange={(v) =>
            sendPatch(
              { ayanamsha: { ayanamsha: Number(v) } },
              { ...opts, ayanamsha: { ...a, ayanamsha: Number(v) } },
            )
          }
        >
          {a.available.map((entry) => (
            <option key={entry.index} value={entry.index}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Orbs  (orbisdlg: target selector → 12 aspect orbs + par/contrapar)
// ---------------------------------------------------------------------------

type FixedStarOrbRow = { name: string; orb: number };
type OrbsWithFixedStars = OptionsPayload["orbs"] & { fixstarsOrbs?: FixedStarOrbRow[] };

function OrbsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const o = opts.orbs as OrbsWithFixedStars;
  const cat = opts.catalog;
  // Target: 0..10 = planets/Nodes (orbis rows), "A" = Asc/MC (orbisAscMC),
  // "H" = Houses (orbisH). Mirrors orbisdlg's per-target radio list.
  const [target, setTarget] = React.useState<string>("0");
  const [fixedStarName, setFixedStarName] = React.useState<string>(o.fixstarsOrbs?.[0]?.name ?? "");
  const isHouses = target === "H";
  const isAscMC = target === "A";
  const ti = Number(target);
  const fixedStarRows = o.fixstarsOrbs ?? [];
  const selectedFixedStar = fixedStarRows.find((row) => row.name === fixedStarName) ?? fixedStarRows[0];

  const aspectVals = isHouses ? o.orbisH : isAscMC ? o.orbisAscMC : (o.orbis[ti] ?? []);
  const parVals = isHouses ? o.orbisparH : isAscMC ? o.orbisparAscMC : (o.orbisplanetspar[ti] ?? []);

  const setAspect = (aspectIdx: number, n: number) => {
    if (isHouses) {
      const next = [...o.orbisH];
      next[aspectIdx] = n;
      sendPatch({ orbs: { orbisH: next } }, { ...opts, orbs: { ...o, orbisH: next } });
    } else if (isAscMC) {
      const next = [...o.orbisAscMC];
      next[aspectIdx] = n;
      sendPatch({ orbs: { orbisAscMC: next } }, { ...opts, orbs: { ...o, orbisAscMC: next } });
    } else {
      const nextMatrix = o.orbis.map((row) => [...row]);
      nextMatrix[ti][aspectIdx] = n;
      sendPatch({ orbs: { orbis: nextMatrix } }, { ...opts, orbs: { ...o, orbis: nextMatrix } });
    }
  };
  const setPar = (col: 0 | 1, n: number) => {
    if (isHouses) {
      const next = [...o.orbisparH];
      next[col] = n;
      sendPatch({ orbs: { orbisparH: next } }, { ...opts, orbs: { ...o, orbisparH: next } });
    } else if (isAscMC) {
      const next = [...o.orbisparAscMC];
      next[col] = n;
      sendPatch({ orbs: { orbisparAscMC: next } }, { ...opts, orbs: { ...o, orbisparAscMC: next } });
    } else {
      const next = o.orbisplanetspar.map((row) => [...row]);
      next[ti][col] = n;
      sendPatch({ orbs: { orbisplanetspar: next } }, { ...opts, orbs: { ...o, orbisplanetspar: next } });
    }
  };
  const setScalar = (attr: "orbiscuspH" | "orbiscuspAscMC" | "exact" | "fixstarsOrbAll", n: number) => {
    sendPatch({ orbs: { [attr]: n } }, { ...opts, orbs: { ...o, [attr]: n } });
  };
  const setFixedStarOrb = (name: string, n: number) => {
    const nextRows = fixedStarRows.map((row) => (row.name === name ? { ...row, orb: n } : row));
    sendPatch(
      { orbs: { fixstarsOrb: { name, orb: n } } } as OptionsPatch,
      { ...opts, orbs: { ...o, fixstarsOrbs: nextRows } as OrbsWithFixedStars },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.target")}</SectionLabel>
      <Row label={t("settings.bodyPoint")}>
        <Select value={target} width={150} onChange={setTarget}>
          {cat.orbTargets.map((opt) => (
            <option key={opt.value} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
          <option value="A">{t("settings.ascMc")}</option>
          <option value="H">{t("settings.houses")}</option>
        </Select>
      </Row>

      <SectionLabel>{t("settings.aspectOrbsDegrees")}</SectionLabel>
      {cat.aspectLabels.map((label, i) => (
        <Row
          key={label}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={cat.aspectGlyphs[i] ?? ""} />
              {label}
            </span>
          }
        >
          <NumberField value={aspectVals[i] ?? 0} step={0.5} onCommit={(n) => setAspect(i, n)} />
        </Row>
      ))}

      <SectionLabel>{t("settings.declination")}</SectionLabel>
      <Row label={t("settings.parallel")}>
        <NumberField value={parVals[0] ?? 0} step={0.5} onCommit={(n) => setPar(0, n)} />
      </Row>
      <Row label={t("settings.contraparallel")}>
        <NumberField value={parVals[1] ?? 0} step={0.5} onCommit={(n) => setPar(1, n)} />
      </Row>

      <SectionLabel>{t("settings.cuspsExactness")}</SectionLabel>
      <Row label={t("settings.ascMcCuspOrb")}>
        <NumberField value={o.orbiscuspAscMC} step={0.5} onCommit={(n) => setScalar("orbiscuspAscMC", n)} />
      </Row>
      <Row label={t("settings.intermediateCuspOrb")}>
        <NumberField value={o.orbiscuspH} step={0.5} onCommit={(n) => setScalar("orbiscuspH", n)} />
      </Row>
      <Row label={t("settings.exactOrb")}>
        <NumberField value={o.exact} step={0.5} onCommit={(n) => setScalar("exact", n)} />
      </Row>

      <SectionLabel>{t("settings.fixedStars")}</SectionLabel>
      <Row label={t("settings.conjunctionOrbAllStars")}>
        <NumberField
          value={o.fixstarsOrbAll}
          step={0.5}
          min={0}
          max={6}
          onCommit={(n) => setScalar("fixstarsOrbAll", n)}
        />
      </Row>
      {selectedFixedStar ? (
        <>
          <Row label={t("settings.selectedStar")}>
            <Select value={selectedFixedStar.name} width={180} onChange={setFixedStarName}>
              {fixedStarRows.map((row) => (
                <option key={row.name} value={row.name}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Row>
          <Row label={t("settings.selectedStarOrb")}>
            <NumberField
              value={selectedFixedStar.orb}
              step={0.5}
              min={0}
              max={6}
              onCommit={(n) => setFixedStarOrb(selectedFixedStar.name, n)}
            />
          </Row>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 6 — Dignities  (scalar fields the backend exposes; matrix is passthrough)
// ---------------------------------------------------------------------------

// Morinus sign glyphs in zodiac order (Aries..Pisces) — header chars for the
// dignity/term grids. The Morinus font maps these letters to the sign glyphs
// (common.py Signs1 'a'..'l'); mirrored here as column-header decoration only.
const SIGN_GLYPH_CHARS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];

function DignitiesTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const g = opts.dignities;
  const cat = opts.catalog;
  const setBool = (attr: "showterms" | "dignitylabelcolors", v: boolean) => {
    sendPatch({ dignities: { [attr]: v } }, { ...opts, dignities: { ...g, [attr]: v } });
  };
  const setScore = (i: number, n: number) => {
    const next = [...g.dignityscores];
    next[i] = Math.round(n);
    sendPatch({ dignities: { dignityscores: next } }, { ...opts, dignities: { ...g, dignityscores: next } });
  };

  // Active term-set selector (selterm). Choices come from catalog.termSets
  // (Egyptian/Ptolemaic); the daemon reads/applies selterm already.
  const setTermSet = (value: number) => {
    sendPatch({ dignities: { selterm: value } }, { ...opts, dignities: { ...g, selterm: value } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.display")}</SectionLabel>
      <Row label={t("settings.showTerms")}>
        <Toggle checked={g.showterms} onChange={(v) => setBool("showterms", v)} />
      </Row>
      <Row label={t("settings.colorDignityLabels")}>
        <Toggle checked={g.dignitylabelcolors} onChange={(v) => setBool("dignitylabelcolors", v)} />
      </Row>

      <SectionLabel>{t("settings.dignityScores")}</SectionLabel>
      {cat.dignityScoreLabels.map((label, i) => (
        <Row key={label} label={label}>
          <NumberField value={g.dignityscores[i] ?? 0} step={1} onCommit={(n) => setScore(i, n)} />
        </Row>
      ))}

      <DignityGridEditor opts={opts} sendPatch={sendPatch} />

      {cat.termSets.length > 0 ? (
        <>
          <SectionLabel>{t("settings.termSet")}</SectionLabel>
          <Row label={t("settings.activeTerms")}>
            <Select value={g.selterm} width={140} onChange={(v) => setTermSet(Number(v))}>
              {cat.termSets.map((ts) => (
                <option key={ts.value} value={ts.value}>
                  {ts.label}
                </option>
              ))}
            </Select>
          </Row>
        </>
      ) : null}

      <TermsGridEditor opts={opts} sendPatch={sendPatch} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Essential-dignities grid editor (DignitiesDlg, dignitiesdlg.py). The wx dialog
// picks one planet + Domicile/Exaltatio at a time and shows 12 sign checkboxes;
// the native idiom shows the whole grid. Cell = options.dignities[planet][type]
// [sign] (bool). The full grid is sent back whole; the daemon setattrs it and
// recalcs (almutens/dignity tables re-read options.dignities). Planets = the 10
// the wx check() loop edits (Sun..Pluto); nodes are excluded by design.
// ---------------------------------------------------------------------------
function DignityGridEditor({ opts, sendPatch }: TabProps) {
  const t = useT();
  const g = opts.dignities;
  const cat = opts.catalog;
  const grid = g.dignities;
  const planets = cat.dignityPlanets;
  const types = cat.dignityTypes;
  if (!Array.isArray(grid) || grid.length === 0 || planets.length === 0) return null;

  const toggle = (pl: number, ty: number, sign: number) => {
    // Deep-clone only the touched planet/type row, structural-share the rest.
    const next: boolean[][][] = grid.map((p, pi) =>
      pi === pl ? p.map((typeRow, ti) => (ti === ty ? typeRow.map((v, si) => (si === sign ? !v : v)) : typeRow)) : p,
    );
    sendPatch({ dignities: { dignities: next } }, { ...opts, dignities: { ...g, dignities: next } });
  };

  return (
    <>
      <SectionLabel>{t("settings.essentialDignities")}</SectionLabel>
      <div className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-0 text-[length:var(--aries-font-size-small)]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-popover px-[var(--aries-table-cell-x-standard)] py-[var(--aries-segmented-control-padding)] text-left font-normal text-foreground/55" />
              {SIGN_GLYPH_CHARS.map((ch, si) => (
                <th key={si} className="px-[var(--aries-table-cell-x-standard)] py-[var(--aries-segmented-control-padding)] text-center font-normal text-foreground/55">
                  <Glyph ch={ch} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {planets.map((plName, pi) =>
              types.map((tyName, ti) => (
                <tr key={`${pi}-${ti}`}>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-popover px-[var(--aries-table-cell-x-standard)] py-[var(--aries-segmented-control-padding)] text-foreground/70">
                    {plName}
                    <span className="ml-1 text-foreground/40">{ti === 0 ? t("settings.domicileAbbr") : t("settings.exaltationAbbr")}</span>
                  </td>
                  {SIGN_GLYPH_CHARS.map((_, si) => (
                    <td key={si} className="px-[var(--aries-table-cell-x-standard)] py-[var(--aries-segmented-control-padding)] text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(grid[pi]?.[ti]?.[si])}
                        onChange={() => toggle(pi, ti, si)}
                        className="h-3 w-3 cursor-pointer accent-foreground/70"
                        aria-label={`${plName} ${tyName} ${si}`}
                      />
                    </td>
                  ))}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Terms / bounds grid editor (TermsDlg, termsdlg.py). Edits the ACTIVE term-set
// (selterm) only — options.terms[selterm][sign][position] = [planetCode, deg].
// The wx dialog validates before OK (each sign's 5 rulers unique, degree spans
// sum to 30 — termsdlg.py:_terms_layout_valid/onOK); that validation is skin
// logic, so we run it client-side and only patch a sign row when it is valid.
// The full terms grid (both sets) is sent back whole; the daemon setattrs it.
// ---------------------------------------------------------------------------
const SIGN_DEG_TOTAL = 30;

function termSignValid(positions: [number, number][]): boolean {
  const seen = new Set<number>();
  let sum = 0;
  for (const [pl, deg] of positions) {
    if (seen.has(pl)) return false; // duplicate ruler in this sign
    seen.add(pl);
    sum += deg;
  }
  return sum === SIGN_DEG_TOTAL;
}

function TermsGridEditor({ opts, sendPatch }: TabProps) {
  const t = useT();
  const g = opts.dignities;
  const cat = opts.catalog;
  const allSets = g.terms;
  const planetChoices = cat.termPlanets;
  const signLabels = cat.zodiacSigns;
  if (!Array.isArray(allSets) || allSets.length === 0 || planetChoices.length === 0) return null;

  const setIdx = g.selterm >= 0 && g.selterm < allSets.length ? g.selterm : 0;
  const signs = allSets[setIdx];
  if (!Array.isArray(signs)) return null;

  // Patch one cell field (planet code or degrees) of the active set. Validates
  // the affected sign row; an invalid row (dup ruler / spans != 30) is held in
  // local edit state and not sent until it becomes valid.
  const writeCell = (sign: number, pos: number, field: 0 | 1, value: number) => {
    const nextSet: [number, number][][] = signs.map((row, ri) =>
      ri === sign
        ? row.map((pair, pj) =>
            pj === pos
              ? ((field === 0 ? [value, pair[1]] : [pair[0], value]) as [number, number])
              : pair,
          )
        : row,
    );
    if (!termSignValid(nextSet[sign])) return false;
    const nextAll: [number, number][][][] = allSets.map((s, si) => (si === setIdx ? nextSet : s));
    sendPatch({ dignities: { terms: nextAll } }, { ...opts, dignities: { ...g, terms: nextAll } });
    return true;
  };

  return (
    <>
      <SectionLabel>{t("settings.termsBoundsActiveSet")}</SectionLabel>
      <div className="overflow-x-auto pb-1 text-[length:var(--aries-font-size-small)]">
        <table className="border-separate border-spacing-x-1 border-spacing-y-0.5">
          <tbody>
            {signs.map((row, si) => {
              const valid = termSignValid(row);
              return (
                <tr key={si}>
                  <td className="whitespace-nowrap px-[var(--aries-table-cell-x-standard)] text-foreground/70">
                    <Glyph ch={SIGN_GLYPH_CHARS[si]} />
                    <span className="ml-1 text-foreground/55">{signLabels[si]}</span>
                  </td>
                  {row.map(([plCode, deg], pos) => (
                    <td key={pos} className="px-0.5">
                      <span className="flex items-center gap-0.5">
                        <TermPlanetSelect
                          value={plCode}
                          choices={planetChoices}
                          onChange={(v) => writeCell(si, pos, 0, v)}
                        />
                        <TermDegInput value={deg} onCommit={(n) => writeCell(si, pos, 1, n)} />
                      </span>
                    </td>
                  ))}
                  <td className="px-[var(--aries-table-cell-x-standard)] text-right tabular-nums text-foreground/40">
                    {valid ? "" : `∑ ${row.reduce((a, [, d]) => a + d, 0)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-[var(--aries-table-cell-x-standard)] pb-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-section)] text-foreground/40">
        {t("settings.termsBoundsHelp")}
      </p>
    </>
  );
}

function TermPlanetSelect({
  value,
  choices,
  onChange,
}: {
  value: number;
  choices: { value: number; label: string }[];
  onChange: (v: number) => void;
}) {
  return (
    <select
      data-aries-control-appearance="local"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-[var(--aries-control-height-micro)] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-segmented-control-padding)] text-[length:var(--aries-font-size-small)] outline-none focus:border-border"
    >
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label.slice(0, 3)}
        </option>
      ))}
    </select>
  );
}

function TermDegInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  return (
    <input
      data-aries-control-appearance="local"
      key={value}
      type="number"
      min={0}
      max={30}
      step={1}
      defaultValue={value}
      onBlur={(e) => {
        let n = Math.round(Number(e.target.value));
        if (!Number.isFinite(n)) {
          e.target.value = String(value);
          return;
        }
        n = Math.max(0, Math.min(30, n));
        if (n !== value) onCommit(n);
        else e.target.value = String(value);
      }}
      className="h-[var(--aries-control-height-micro)] w-[34px] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap-compact)] text-right text-[length:var(--aries-font-size-small)] tabular-nums outline-none focus:border-border"
    />
  );
}

// ---------------------------------------------------------------------------
// Symbols  (symbolsdlg.SymbolsDlg) — glyph-variant choices. The daemon owns
// WHICH variants exist and the Morinus glyph char for each (catalog.symbol*);
// this tab renders a radio row per option and patches the chosen value. The
// chart snapshot already resolves the picked glyph (common.common.update is
// re-run daemon-side on apply), so the wheel reflects the choice on re-render.
// ---------------------------------------------------------------------------

/** A horizontal row of glyph-variant choices; the selected one is highlighted.
 * Each choice renders its Morinus glyph (font-family Morinus). */
function GlyphChoiceRow<V extends boolean | number>({
  choices,
  current,
  onPick,
}: {
  choices: { value: V; glyph: string }[];
  current: V;
  onPick: (v: V) => void;
}) {
  return (
    <span className="flex items-center gap-[var(--aries-control-gap)]">
      {choices.map((c) => (
        <button
          key={String(c.value)}
          type="button"
          onClick={() => onPick(c.value)}
          className={
            "font-symbols flex h-[var(--aries-control-height-small)] w-[var(--aries-control-height-small)] items-center justify-center rounded-[var(--aries-radius-control-compact)] border text-[length:var(--aries-font-size-large)] " +
            (current === c.value
              ? "border-foreground/80 bg-muted text-foreground"
              : "border-border/60 text-foreground/70 hover:border-border")
          }
        >
          {c.glyph}
        </button>
      ))}
    </span>
  );
}

function SymbolsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const s = opts.symbols;
  const cat = opts.catalog;
  const setSymbol = <K extends keyof OptionsSymbols>(attr: K, value: OptionsSymbols[K]) => {
    sendPatch({ symbols: { [attr]: value } }, { ...opts, symbols: { ...s, [attr]: value } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.glyphVariants")}</SectionLabel>
      <Row label={t("settings.uranus")}>
        <GlyphChoiceRow
          choices={cat.symbolUranus as { value: boolean; glyph: string }[]}
          current={s.uranus}
          onPick={(v) => setSymbol("uranus", v)}
        />
      </Row>
      <Row label={t("settings.pluto")}>
        <GlyphChoiceRow
          choices={cat.symbolPluto as { value: number; glyph: string }[]}
          current={s.pluto}
          onPick={(v) => setSymbol("pluto", v)}
        />
      </Row>
      <Row label={t("settings.signs")}>
        <GlyphChoiceRow
          choices={cat.symbolSigns as { value: boolean; glyph: string }[]}
          current={s.signs}
          onPick={(v) => setSymbol("signs", v)}
        />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 7 — Default Location  (defaultlocdlg.DefaultLocDlg). The saved
// "Here-and-Now" place. The daemon owns WHICH def* fields exist + their
// labels/control kinds (catalog.defaultLocationFields); this tab renders generic
// controls from that list (the same "stupid skin" pattern as the other tabs).
// The ONE custom control is the place search: it reuses the chart editor's
// resolve-place flow (daemon-form-shaped candidates) and, on pick, patches the
// matching def* fields in a single grouped patch. Manual field edits patch one
// def* field each. Persistence + Here-and-Now reconstruction are daemon-side.
// ---------------------------------------------------------------------------

/** A two-state segmented toggle for `sign` fields (E/W, N/S, +/-). true ==
 * positive (left) value. */
function SignToggle({
  value,
  positive,
  negative,
  onChange,
}: {
  value: boolean;
  positive: string;
  negative: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <span className="flex overflow-hidden rounded-[var(--aries-radius-control-compact)] border border-border/60 text-[length:var(--aries-font-size-base)]">
      {[
        { v: true, label: positive },
        { v: false, label: negative },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onChange(o.v)}
          className={
            "w-[var(--aries-control-height-small)] py-[var(--aries-segmented-control-padding)] text-center " +
            (value === o.v ? "bg-foreground/80 text-background" : "text-foreground/70")
          }
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Uncontrolled text field committed on blur, keyed by value so a server-driven
 * change remounts with the fresh value (same trick as NumberField). */
function TextField({
  value,
  width = 120,
  onCommit,
}: {
  value: string;
  width?: number;
  onCommit: (s: string) => void;
}) {
  return (
    <input
      data-aries-control-appearance="local"
      key={value}
      type="text"
      defaultValue={value}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      style={{ width }}
      className="h-[var(--aries-control-height-micro)] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
    />
  );
}

/** Place search reusing the editor's resolve-place flow. Type ≥3 chars + Enter
 * (or the Search button) → daemon-form-shaped candidates; picking one fills the
 * def* fields via `onPick`. The daemon does all geo math (decToDeg split, sign,
 * GMT offset, tzid) — this control only assigns the returned fields. */
function PlaceSearch({ onPick }: { onPick: (c: PlaceCandidate) => void }) {
  const t = useT();
  const [query, setQuery] = React.useState("");
  const [candidates, setCandidates] = React.useState<PlaceCandidate[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const run = React.useCallback(() => {
    const q = query.trim();
    if (q.length < 3) {
      setErr(t("settings.typeAtLeast3Chars"));
      return;
    }
    setErr(null);
    setBusy(true);
    resolvePlace(q)
      .then((rows) => {
        setCandidates(rows);
        if (rows.length === 0) setErr(t("settings.noMatchingPlace"));
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  }, [query, t]);

  const pick = (c: PlaceCandidate) => {
    onPick(c);
    setCandidates(null);
    setQuery(c.name);
  };

  return (
    <div className="flex flex-col gap-[var(--aries-control-gap)]">
      <div className="flex items-center gap-[var(--aries-control-gap)]">
        <input
          data-aries-control-appearance="local"
          type="text"
          value={query}
          placeholder={t("settings.searchCity")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          className="h-[var(--aries-control-height-compact)] flex-1 rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
        />
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="h-[var(--aries-control-height-compact)] rounded-[var(--aries-radius-control-compact)] border border-border/60 px-[var(--aries-control-padding-x)] text-[length:var(--aries-font-size-base)] text-foreground/80 hover:border-border hover:text-foreground disabled:opacity-50"
        >
          {busy ? "…" : t("settings.search")}
        </button>
      </div>
      {err ? <div className="text-[length:var(--aries-font-size-small)] text-foreground/55">{err}</div> : null}
      {candidates && candidates.length > 0 ? (
        <div className="max-h-40 overflow-y-auto rounded-[var(--aries-radius-control-compact)] border border-border/50">
          {candidates.map((c, i) => (
            <button
              key={`${c.label}-${i}`}
              type="button"
              onClick={() => pick(c)}
              className="flex w-full items-center justify-between gap-[var(--aries-form-row-gap)] border-b border-border/40 px-[var(--aries-control-padding-x-compact)] py-[var(--aries-control-padding-y)] text-left last:border-b-0 hover:bg-muted"
            >
              <span className="truncate text-[length:var(--aries-font-size-base)] text-foreground/85">{c.label}</span>
              <span className="shrink-0 text-[length:var(--aries-font-size-small)] text-foreground/50">{c.countryName}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Default-location map picker — a modal sheet over the Settings dialog that
 * hosts the SAME Res/astrocart/map.html surface wx opens from the Default
 * Location dialog's "Map" button (morin._open_astrocart_from_chart_editor with
 * context='default_location', morin.py:16466). The map is launched in
 * `default_location` context (window.ACG.setContext('default_location') via the
 * aries.setContext postMessage bridge, map.html:2551) so the right-click menu
 * surfaces ONLY "Set default location" — the chart-bound items (relocation / SR
 * / transit / set place of birth) are hidden by map.html's data-mode CSS gating
 * (map.html:328-331).
 *
 * No ACG line data is fetched: in the settings flow there is no chart, just a
 * globe to search or click. Choosing a search result posts its exact pin as a
 * `place-selection`, which the dialog commits with OK. The existing right-click
 * "Set default location" action remains available and uses the same daemon
 * pipeline (setDefaultLocationFromMap -> morin._astrocart_set_default_location
 * parity), which resolves the place name + timezone, persists the defloc* group,
 * and broadcasts options.changed.
 */
function DefaultLocationMapSheet({
  open,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (group: OptionsDefaultLocation) => void;
}) {
  const t = useT();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const applyControllerRef = React.useRef<AbortController | null>(null);
  const [readyUrl, setReadyUrl] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<{
    lon: number;
    lat: number;
    placeName: string;
  } | null>(null);
  const [applying, setApplying] = React.useState(false);
  const theme = useThemeStore((s) => s.theme);
  const bootTheme = theme?.mode === "light" ? "light" : "dark";
  const bootPageBg = theme?.chartPalette["--aries-astrocart-map-page-bg"]
    ?? (bootTheme === "light" ? "#d9dde1" : "#1a1d21");
  // Same stable map.html contract as AstrocartSurface: bundled viewport city
  // labels online/offline, with theme changes pushed live instead of reloading.
  const [mapBootOptions] = React.useState(() => ({
    theme: bootTheme,
    pageBg: bootPageBg,
    places: "auto",
  } as const));
  const url = useAstrocartMapUrl(mapBootOptions);
  const ready = !!url && readyUrl === url;

  const applySelection = React.useCallback((next: {
    lon: number;
    lat: number;
    placeName: string;
  }) => {
    if (applyControllerRef.current) return;
    const controller = new AbortController();
    applyControllerRef.current = controller;
    setApplying(true);
    void setDefaultLocationFromMap(next.lon, next.lat, next.placeName, controller.signal)
      .then((res) => {
        if (controller.signal.aborted || applyControllerRef.current !== controller) return;
        applyControllerRef.current = null;
        setApplying(false);
        onApplied(res.defaultLocation);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        applyControllerRef.current = null;
        setApplying(false);
        console.error("[defloc-map]", err);
      });
  }, [onApplied]);

  React.useEffect(() => () => applyControllerRef.current?.abort(), []);

  // Once the iframe is loaded, flip the right-click menu to default_location
  // mode (only "Set default location" shows). map.html's setContext is the wx
  // twin of window.ACG.setContext (map.html:2517).
  React.useEffect(() => {
    if (!open || !ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "aries.setContext", mode: "default_location" }, "*");
    if (bootTheme) {
      win.postMessage({ type: "aries.setTheme", theme: bootTheme, pageBg: bootPageBg }, "*");
    }
  }, [open, ready, bootTheme, bootPageBg]);

  React.useEffect(() => {
    if (!open || !ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const controller = new AbortController();
    void daemonFetch(`${daemonBaseUrl()}/api/astrocart/style`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`astrocart style fetch failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (controller.signal.aborted || iframeRef.current?.contentWindow !== win) return;
        win.postMessage(createAstrocartStyleMessage(payload), "*");
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.error("[defloc-map-style]", err);
      });
    return () => controller.abort();
  }, [open, ready, theme?.styleHash, theme?.styleRevision]);

  // Listen for search-pin selection and the existing right-click intent from
  // THIS iframe only. Both commit through the same daemon-owned pipeline.
  React.useEffect(() => {
    if (!open) return;
    function onMessage(event: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data = event.data as
        | { source?: string; payload?: { type?: string; action?: string; lon?: number; lat?: number; placeName?: string } }
        | undefined;
      if (!data || data.source !== "aries-acg") return;
      const payload = data.payload;
      if (!payload) return;
      if (typeof payload.lon !== "number" || typeof payload.lat !== "number") return;
      const next = {
        lon: payload.lon,
        lat: payload.lat,
        placeName: payload.placeName ?? "",
      };
      if (payload.type === "place-selection") {
        setSelection(next);
        return;
      }
      if (payload.type === "here" && payload.action === "set_default_loc") {
        applySelection(next);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applySelection, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) applyControllerRef.current?.abort();
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="xl" motion="none" className="gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/40 px-[var(--aries-dialog-padding)] pb-2.5 pt-3">
          <DialogTitle className="text-[length:var(--aries-font-size-reading)] font-medium tracking-tight">
            {t("settings.pickDefaultLocation")}
          </DialogTitle>
          <p className="text-[length:var(--aries-font-size-small)] text-foreground/50">
            {t("settings.rightClickSetDefaultLocation")}
          </p>
        </DialogHeader>
        <div className="relative h-[60vh] w-full bg-background">
          {open && url ? (
            <iframe
              key={url}
              ref={iframeRef}
              src={url}
              title={t("settings.defaultLocationMap")}
              className="h-full w-full border-0 bg-background"
              onLoad={() => setReadyUrl(url)}
            />
          ) : null}
        </div>
        <div className="flex h-11 items-center gap-[var(--aries-dialog-footer-gap)] border-t border-border/40 bg-muted/20 px-[var(--aries-dialog-padding)]">
          <span className="min-w-0 flex-1 truncate text-[length:var(--aries-font-size-small)] text-foreground/55">
            {selection?.placeName ?? ""}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="min-w-[var(--aries-dialog-map-action-min-width)] rounded-[var(--aries-radius-control-compact)] border-border/60 bg-transparent px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)] text-[length:var(--aries-font-size-base)] font-normal text-foreground/75 hover:bg-transparent hover:text-foreground dark:border-border/60 dark:bg-transparent dark:hover:bg-transparent"
          >
            {t("settings.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selection || applying}
            onClick={() => {
              if (selection) applySelection(selection);
            }}
            className="min-w-[var(--aries-dialog-map-action-min-width)] rounded-[var(--aries-radius-control-compact)] border-0 px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)] text-[length:var(--aries-font-size-base)] font-normal hover:bg-primary/90 disabled:cursor-default disabled:opacity-40"
          >
            {t("picker.ok")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DefaultLocationTab({
  opts,
  sendPatch,
  onDefaultLocationApplied,
}: TabProps & {
  onDefaultLocationApplied: (group: OptionsDefaultLocation) => void;
}) {
  const t = useT();
  const loc = opts.defaultLocation;
  const fields = opts.catalog.defaultLocationFields;
  const [mapOpen, setMapOpen] = React.useState(false);
  const exactLongitude = loc.defloclon ?? (
    (loc.defloceast ? 1 : -1) * (loc.defloclondeg + loc.defloclonmin / 60)
  );
  const exactLatitude = loc.defloclat ?? (
    (loc.deflocnorth ? 1 : -1) * (loc.defloclatdeg + loc.defloclatmin / 60)
  );

  // Patch one def* field (manual edit) — optimistic, like the other tabs.
  const setField = <K extends keyof OptionsDefaultLocation>(
    attr: K,
    value: OptionsDefaultLocation[K],
  ) => {
    sendPatch(
      { defaultLocation: { [attr]: value } },
      { ...opts, defaultLocation: { ...loc, [attr]: value } },
    );
  };

  // Picking a resolved place fills the def* fields in ONE grouped patch — the
  // candidate is already form-shaped by the daemon (resolve-place), so map its
  // fields straight onto the def* keys (name, deg/min + E/W·N/S, altitude, GMT
  // offset, tzid). Auto-DST/TZ is left to the user's existing toggle.
  const applyPlace = (c: PlaceCandidate) => {
    const patch: Partial<OptionsDefaultLocation> = {
      deflocname: c.name,
      defloclondeg: c.lonDeg,
      defloclonmin: c.lonMin,
      defloclon: c.lon,
      defloceast: c.east,
      defloclatdeg: c.latDeg,
      defloclatmin: c.latMin,
      defloclat: c.lat,
      deflocnorth: c.north,
      deflocalt: c.altitude,
      deflocplus: c.plus,
      defloczhour: c.zoneHour,
      defloczminute: c.zoneMin,
      defloctzid: c.tzid,
    };
    sendPatch(
      { defaultLocation: patch },
      { ...opts, defaultLocation: { ...loc, ...patch } },
    );
  };

  const renderControl = (f: DefaultLocationFieldMeta) => {
    switch (f.kind) {
      case "name":
        return <TextField value={loc.deflocname} width={140} onCommit={(s) => setField("deflocname", s.slice(0, 20))} />;
      case "text":
        return (
          <TextField
            value={String(loc[f.attr] ?? "")}
            width={140}
            onCommit={(s) => setField(f.attr, s as never)}
          />
        );
      case "int":
        return (
          <NumberField
            value={Number(loc[f.attr] ?? 0)}
            step={1}
            onCommit={(n) => setField(f.attr, (Number.isFinite(n) ? Math.trunc(n) : 0) as never)}
          />
        );
      case "sign":
        return (
          <SignToggle
            value={Boolean(loc[f.attr])}
            positive={f.positive ?? "+"}
            negative={f.negative ?? "-"}
            onChange={(v) => setField(f.attr, v as never)}
          />
        );
      case "bool":
        return <Toggle checked={Boolean(loc[f.attr])} onChange={(v) => setField(f.attr, v as never)} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-0">
      <div className="pb-2">
        <PlaceSearch onPick={applyPlace} />
      </div>
      <div className="flex items-center justify-between pb-2">
        <p className="text-[length:var(--aries-font-size-small)] text-foreground/50">
          {t("settings.usedByHereAndNow")}
        </p>
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="h-[var(--aries-control-height-compact)] shrink-0 rounded-[var(--aries-radius-control-compact)] border border-border/60 px-[var(--aries-control-padding-x)] text-[length:var(--aries-font-size-base)] text-foreground/80 hover:border-border hover:text-foreground"
        >
          {t("settings.pickOnMap")}
        </button>
      </div>
      {mapOpen ? (
        <DefaultLocationMapSheet
          open={mapOpen}
          onOpenChange={setMapOpen}
          onApplied={(group) => {
            onDefaultLocationApplied(group);
            setMapOpen(false);
          }}
        />
      ) : null}

      <SectionLabel>{t("settings.place")}</SectionLabel>
      <Row label={t("common.longitude")}>
        <span className="font-mono text-[length:var(--aries-font-size-base)] tabular-nums text-foreground/80">
          {exactLongitude.toFixed(6)}°
        </span>
      </Row>
      <Row label={t("common.latitude")}>
        <span className="font-mono text-[length:var(--aries-font-size-base)] tabular-nums text-foreground/80">
          {exactLatitude.toFixed(6)}°
        </span>
      </Row>
      {fields
        .filter((f) => f.kind === "name" || f.attr.startsWith("defloclon") || f.attr.startsWith("defloclat") || f.attr === "deflocalt" || f.attr === "defloceast" || f.attr === "deflocnorth")
        .map((f) => (
          <Row key={f.attr} label={f.label}>
            {renderControl(f)}
          </Row>
        ))}

      <SectionLabel>{t("settings.timeZone")}</SectionLabel>
      {fields
        .filter(
          (f) =>
            f.attr === "defloctzauto" ||
            f.attr === "deflocplus" ||
            f.attr === "defloczhour" ||
            f.attr === "defloczminute" ||
            f.attr === "deflocdst" ||
            f.attr === "defloctzid",
        )
        .map((f) => (
          <Row key={f.attr} label={f.label}>
            {renderControl(f)}
          </Row>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 10 — Revolutions (revolutionsoptdlg.RevolutionsOptDlg)
// ---------------------------------------------------------------------------

function RevolutionsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const r = opts.revolutions;

  const setInt = (
    attr: Extract<
      keyof OptionsRevolutions,
      | "revolutions_solaryearmode"
      | "revolutions_solarlocationmode"
      | "revolutions_lunarlocationmode"
      | "revolutions_planetslocationmode"
      | "revolutions_lunarparentmode"
    >,
    raw: string,
  ) => {
    const value = Number(raw) === 1 ? 1 : 0;
    sendPatch(
      { revolutions: { [attr]: value } },
      { ...opts, revolutions: { ...r, [attr]: value } },
    );
  };

  const setBool = (
    attr: Extract<
      keyof OptionsRevolutions,
      "revsidereal_marr_solar" | "revsidereal_marr_lunar" | "revsidereal_marr_planet"
    >,
    value: boolean,
  ) => {
    sendPatch(
      { revolutions: { [attr]: value } },
      { ...opts, revolutions: { ...r, [attr]: value } },
    );
  };

  const setReturnMode = (
    attr: "revolutions_solarreturnmode" | "revolutions_lunarreturnmode",
    value: string,
  ) => {
    sendPatch(
      { revolutions: { [attr]: value } },
      { ...opts, revolutions: { ...r, [attr]: value } },
    );
  };

  const locationSelect = (
    attr: "revolutions_solarlocationmode" | "revolutions_lunarlocationmode" | "revolutions_planetslocationmode",
  ) => (
    <Select value={r[attr]} width={150} onChange={(v) => setInt(attr, v)}>
      <option value={0}>{t("settings.useNatal")}</option>
      <option value={1}>{t("settings.ask")}</option>
    </Select>
  );

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.solarReturn")}</SectionLabel>
      <Row label={t("settings.precessedSidereal")}>
        <Toggle checked={r.revsidereal_marr_solar} onChange={(v) => setBool("revsidereal_marr_solar", v)} />
      </Row>
      <Row label={t("settings.year")}>
        <Select value={r.revolutions_solaryearmode} width={150} onChange={(v) => setInt("revolutions_solaryearmode", v)}>
          <option value={0}>{t("settings.currentYear")}</option>
          <option value={1}>{t("settings.nextYear")}</option>
        </Select>
      </Row>
      <Row label={t("settings.location")}>{locationSelect("revolutions_solarlocationmode")}</Row>
      <Row label={t("chartmenu.tithiPravesha")}>
        <Toggle checked={r.revolutions_solarreturnmode === "tithi_pravesha"} onChange={(v) => setReturnMode("revolutions_solarreturnmode", v ? "tithi_pravesha" : "standard")} />
      </Row>

      <SectionLabel>{t("settings.lunarReturn")}</SectionLabel>
      <Row label={t("settings.precessedSidereal")}>
        <Toggle checked={r.revsidereal_marr_lunar} onChange={(v) => setBool("revsidereal_marr_lunar", v)} />
      </Row>
      <Row label={t("settings.location")}>{locationSelect("revolutions_lunarlocationmode")}</Row>
      <Row label={t("settings.parentChart")}>
        <Select value={r.revolutions_lunarparentmode} width={170} onChange={(v) => setInt("revolutions_lunarparentmode", v)}>
          <option value={0}>{t("settings.useRadixMoon")}</option>
          <option value={1}>{t("settings.useSolarReturnMoon")}</option>
        </Select>
      </Row>
      <Row label={t("chartmenu.lunarPhaseEmbolismic")}>
        <Toggle checked={r.revolutions_lunarreturnmode === "soli_lunar"} onChange={(v) => setReturnMode("revolutions_lunarreturnmode", v ? "soli_lunar" : "lunar")} />
      </Row>
      <Row label={t("chartmenu.jonasArc")}>
        <Toggle checked={r.revolutions_lunarreturnmode === "jonas_arc"} onChange={(v) => setReturnMode("revolutions_lunarreturnmode", v ? "jonas_arc" : "lunar")} />
      </Row>

      <SectionLabel>{t("settings.planetaryReturns")}</SectionLabel>
      <Row label={t("settings.precessedSidereal")}>
        <Toggle checked={r.revsidereal_marr_planet} onChange={(v) => setBool("revsidereal_marr_planet", v)} />
      </Row>
      <Row label={t("settings.location")}>{locationSelect("revolutions_planetslocationmode")}</Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Progressions (quickchartsoptdlg.QuickChartsOptDlg).
// progressed_angle_method / progression_day_type are the secondary-progression
// CALC options (posfordate enums) consumed by the directions list, the
// progression adapters and the stepper.
// Choice values + labels come from the daemon catalog — nothing is computed
// here.
// ---------------------------------------------------------------------------

function ProgressionsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const q = opts.quickCharts;
  const cat = opts.catalog;

  const patch = (fields: Partial<OptionsQuickCharts>) => {
    sendPatch(
      { quickCharts: fields },
      { ...opts, quickCharts: { ...q, ...fields } },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.progressionCalculation")}</SectionLabel>
      <Row label={t("settings.progressedAngles")}>
        <Select
          value={q.progressed_angle_method}
          width={200}
          onChange={(v) => patch({ progressed_angle_method: Number(v) })}
        >
          {cat.progressionAngleMethods.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.dayType")}>
        <Select
          value={q.progression_day_type}
          width={200}
          onChange={(v) => patch({ progression_day_type: Number(v) })}
        >
          {cat.progressionDayTypes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>

      <SectionLabel>{t("settings.launcher")}</SectionLabel>
      <Row label={t("settings.progressionsTransits")}>
        <Select
          value={q.secondary_progression_launch_mode}
          width={150}
          onChange={(v) => patch({ secondary_progression_launch_mode: Number(v) })}
        >
          {cat.secondaryLaunchModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.tableTimes")}>
        <Select
          value={q.event_table_time_basis}
          width={170}
          onChange={(v) => patch({ event_table_time_basis: v })}
        >
          {cat.eventTableTimeModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.timedRowsShowRadix")}>
        <Toggle
          checked={q.timed_chart_show_radix_default}
          onChange={(v) => patch({ timed_chart_show_radix_default: v })}
        />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 11 — Step Alerts (stepalertsdlg.StepAlertsDlg)
// ---------------------------------------------------------------------------

function StepAlertsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const s = opts.stepAlerts;
  const cat = opts.catalog;

  const setEnabled = (value: boolean) => {
    sendPatch(
      { stepAlerts: { stepalerts_enabled: value } },
      { ...opts, stepAlerts: { ...s, stepalerts_enabled: value } },
    );
  };

  const setVec = (
    attr: "stepalerts_promplanets" | "stepalerts_sigplanets" | "stepalerts_sigangles",
    index: number,
    value: boolean,
  ) => {
    const next = [...s[attr]];
    next[index] = value;
    sendPatch(
      { stepAlerts: { [attr]: next } },
      { ...opts, stepAlerts: { ...s, [attr]: next } },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.sound")}</SectionLabel>
      <Row label={t("settings.enableExactConjunctionAlerts")}>
        <Toggle
          checked={s.stepalerts_enabled}
          onChange={setEnabled}
        />
      </Row>

      <SectionLabel>{t("settings.promissors")}</SectionLabel>
      {cat.stepAlertBodies.map((body, i) => (
        <Row
          key={`prom-${body.id}`}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={body.glyph} />
              {body.label}
            </span>
          }
        >
          <Toggle
            checked={Boolean(s.stepalerts_promplanets[i])}
            disabled={!s.stepalerts_enabled}
            onChange={(v) => setVec("stepalerts_promplanets", i, v)}
          />
        </Row>
      ))}

      <SectionLabel>{t("settings.planetSignificators")}</SectionLabel>
      {cat.stepAlertBodies.map((body, i) => (
        <Row
          key={`sig-${body.id}`}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={body.glyph} />
              {body.label}
            </span>
          }
        >
          <Toggle
            checked={Boolean(s.stepalerts_sigplanets[i])}
            disabled={!s.stepalerts_enabled}
            onChange={(v) => setVec("stepalerts_sigplanets", i, v)}
          />
        </Row>
      ))}

      <SectionLabel>{t("settings.angleSignificators")}</SectionLabel>
      {cat.stepAlertAngles.map((angle, i) => (
        <Row key={angle.value} label={angle.label}>
          <Toggle
            checked={Boolean(s.stepalerts_sigangles[i])}
            disabled={!s.stepalerts_enabled}
            onChange={(v) => setVec("stepalerts_sigangles", i, v)}
          />
        </Row>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Planets/Points (wx Options > Planets/Points remainder: Nodes radio
// pair morin.py:14389-14393/19846, fortunedlg.py, syzygydlg.py, and the
// arabicpartsdlg scalar + list state). Catalogs and labels come from the
// daemon (opts.catalog nodeModes/fortunaModes/syzygyModes/arabicPartsRefs);
// the parts list is daemon-rendered (formula text included). The full lot
// formula calculator (add/modify/female/import-export) is deferred — see
// doc/migration/wiring/options-planets-points.md.
// ---------------------------------------------------------------------------

function PlanetsPointsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const p = opts.planetsPoints;
  const cat = opts.catalog;
  const [removeAllPending, setRemoveAllPending] = React.useState(false);

  const patch = (
    fields: NonNullable<OptionsPatch["planetsPoints"]>,
    optimistic?: Partial<OptionsPlanetsPoints>,
  ) => {
    sendPatch(
      { planetsPoints: fields },
      { ...opts, planetsPoints: { ...p, ...(optimistic ?? fields) } },
    );
  };

  const setPartActive = (index: number, active: boolean) => {
    patch(
      { partsActive: [{ index, active }] },
      {
        parts: p.parts.map((part) =>
          part.index === index ? { ...part, active } : part,
        ),
      },
    );
  };

  const removePart = (index: number) => {
    patch(
      { removeIndex: index },
      {
        parts: p.parts
          .filter((part) => part.index !== index)
          .map((part, i) => ({ ...part, index: i })),
      },
    );
  };

  // Bulk active intents — wx All On / All Off / Invert buttons
  // (arabicpartsdlg.py:1396-1412) applied to every user row (the webapp list
  // has no multi-select; per-row Toggle covers single rows).
  const setAllActive = (compute: (part: ArabicPartMeta) => boolean) => {
    patch(
      { partsActive: p.parts.map((part) => ({ index: part.index, active: compute(part) })) },
      { parts: p.parts.map((part) => ({ ...part, active: compute(part) })) },
    );
  };

  // wx OnRemoveAll keeps the synthetic LoF row and asks AreYouSure
  // (arabicpartsdlg.py:2170-2217).
  const removeAll = () => {
    if (p.parts.length === 0) return;
    setRemoveAllPending(true);
  };

  const confirmRemoveAll = () => {
    patch({ removeAll: true }, { parts: [] });
    setRemoveAllPending(false);
  };

  // Add/Edit lot-formula calculator (wx OnAdd/OnModify; all formula semantics
  // live in the Python brain — this editor only collects raw codes/refdeg).
  const [editor, setEditor] = React.useState<
    | { mode: "add" }
    | { mode: "edit"; index: number }
    | null
  >(null);

  const addPart = (spec: ArabicPartSpec) => {
    patch({ addPart: spec });
    setEditor(null);
  };

  const updatePart = (index: number, spec: ArabicPartSpec) => {
    patch({ updatePart: { ...spec, index } });
  };

  const [importStatus, setImportStatus] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const onImportFile = (file: File) => {
    file
      .text()
      .then((text) => importArabicParts(JSON.parse(text) as unknown[]))
      .then((res) => {
        // wx shows "Imported N. Skipped M. K unresolved." (OnImport :2652-2660).
        let msg = t("settings.importedParts", { count: res.imported });
        if (res.skipped > 0) msg += " " + t("settings.skippedParts", { count: res.skipped });
        if (res.unresolved > 0) msg += " " + t("settings.unresolvedRefs", { count: res.unresolved });
        setImportStatus(msg);
        // res IS the authoritative options payload — reconcile through the
        // shared sendPatch path with an empty no-op patch.
        sendPatch({}, res);
      })
      .catch((err) => setImportStatus(`${t("settings.importFailed")}: ${String(err)}`));
  };

  const exportParts = () => {
    exportArabicParts()
      .then((text) => downloadText("arabic_parts.json", text, "application/json"))
      .catch((err) => setImportStatus(`${t("settings.exportFailed")}: ${String(err)}`));
  };

  const fortunaMode = cat.fortunaModes.find((m) => m.value === p.lotoffortune);

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.nodes")}</SectionLabel>
      <Row label={t("settings.nodeCalculation")}>
        <Select
          value={p.meannode ? 1 : 0}
          width={170}
          onChange={(v) => patch({ meannode: Number(v) === 1 })}
        >
          {cat.nodeModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>

      <SectionLabel>{t("settings.lotOfFortune")}</SectionLabel>
      <Row label={t("settings.formula")}>
        <Select
          value={p.lotoffortune}
          width={280}
          onChange={(v) => patch({ lotoffortune: Number(v) })}
        >
          {cat.fortunaModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      {fortunaMode?.sublabel ? (
        <div className="pb-1 pt-0.5 text-right text-[length:var(--aries-font-size-small)] text-foreground/50">
          {fortunaMode.sublabel}
        </div>
      ) : null}

      <SectionLabel>{t("settings.syzygy")}</SectionLabel>
      <Row label={t("settings.referencePoint")}>
        <Select
          value={p.syzmoon}
          width={200}
          onChange={(v) => patch({ syzmoon: Number(v) })}
        >
          {cat.syzygyModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>

      <SectionLabel>{t("settings.arabicParts")}</SectionLabel>
      <Row label={t("settings.ascendantReference")}>
        <Select
          value={p.arabicpartsref}
          width={150}
          onChange={(v) => patch({ arabicpartsref: Number(v) })}
        >
          {cat.arabicPartsRefs.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.dayNightOrbDegrees")}>
        <NumberField
          value={p.daynightorbdeg}
          min={0}
          max={6}
          onCommit={(n) => patch({ daynightorbdeg: n })}
        />
      </Row>
      <Row label={t("settings.dayNightOrbMinutes")}>
        <NumberField
          value={p.daynightorbmin}
          min={0}
          max={59}
          onCommit={(n) => patch({ daynightorbmin: n })}
        />
      </Row>

      <SectionLabel>{t("settings.parts")}</SectionLabel>
      {/* Synthetic locked Fortuna row — the wx list pins LoF as #1 and blocks
          edit/remove/deactivate (arabicpartsdlg.py:791-803). */}
      <div className="flex h-[var(--aries-control-height-small)] items-center justify-between gap-[var(--aries-form-row-gap)] border-b border-border/40 text-[length:var(--aries-font-size-base)]">
        <span className="truncate text-foreground/80">
          #1 {t("settings.fortuna")}
          <span className="ml-2 text-foreground/45">{fortunaMode?.label ?? ""}</span>
        </span>
        <span className="shrink-0 text-[length:var(--aries-font-size-small)] text-foreground/40">{t("settings.locked")}</span>
      </div>
      {p.parts.map((part) => {
        const isEditing = editor?.mode === "edit" && editor.index === part.index;
        return (
          <React.Fragment key={part.index}>
            <div className="flex h-[var(--aries-control-height-small)] items-center justify-between gap-[var(--aries-form-row-gap)] border-b border-border/40 text-[length:var(--aries-font-size-base)]">
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                #{part.index + 2} {part.name}
                <span className="ml-2 text-foreground/45">{part.formula}</span>
                {part.hasNocturnalFormula ? (
                  <span className="ml-1 text-foreground/45">{t("settings.badgeDayNight")}</span>
                ) : part.diurnal ? (
                  <span className="ml-1 text-foreground/45">*</span>
                ) : null}
                {part.gendered || part.hasFemaleFormula ? (
                  <span className="ml-1 text-foreground/45">{t("settings.badgeMaleFemale")}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-[var(--aries-form-field-gap)]">
                <Toggle
                  checked={part.active}
                  onChange={(v) => setPartActive(part.index, v)}
                />
                <button
                  type="button"
                  onClick={() =>
                    setEditor((current) =>
                      current?.mode === "edit" && current.index === part.index
                        ? null
                        : { mode: "edit", index: part.index },
                    )
                  }
                  className="rounded-[var(--aries-radius-xs)] border border-border/60 px-[var(--aries-control-gap)] py-[var(--aries-segmented-control-padding)] text-[length:var(--aries-font-size-small)] text-foreground/60 hover:text-foreground"
                >
                  {isEditing ? t("settings.close") : t("settings.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => removePart(part.index)}
                  className="rounded-[var(--aries-radius-xs)] border border-border/60 px-[var(--aries-control-gap)] py-[var(--aries-segmented-control-padding)] text-[length:var(--aries-font-size-small)] text-foreground/60 hover:text-foreground"
                >
                  {t("settings.remove")}
                </button>
              </span>
            </div>
            {isEditing ? (
              <ArabicPartEditor
                key={`edit-${part.index}`}
                mode="edit"
                part={part}
                parts={p.parts}
                terms={cat.arabicPartTerms}
                signs={cat.zodiacSigns}
                lofName={cat.lotOfFortuneName}
                onSave={(spec) => updatePart(part.index, spec)}
                onAutoSave={(spec) => updatePart(part.index, spec)}
                onCancel={() => setEditor(null)}
              />
            ) : null}
          </React.Fragment>
        );
      })}
      {p.parts.length === 0 ? (
        <div className="py-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-small)] text-foreground/45">{t("settings.noCustomParts")}</div>
      ) : null}

      <div className="mt-[var(--aries-form-field-gap)] flex flex-wrap items-center gap-[var(--aries-control-gap)]">
        <ActionButton onClick={() => setEditor({ mode: "add" })}>{t("settings.addPart")}</ActionButton>
        <ActionButton onClick={() => setAllActive(() => true)}>{t("settings.allOn")}</ActionButton>
        <ActionButton onClick={() => setAllActive(() => false)}>{t("settings.allOff")}</ActionButton>
        <ActionButton onClick={() => setAllActive((part) => !part.active)}>{t("settings.invert")}</ActionButton>
        <ActionButton onClick={removeAll}>{t("settings.removeAll")}</ActionButton>
        <span className="mx-[var(--aries-control-gap-compact)] h-[var(--aries-control-icon-size-default)] w-[var(--aries-sash-rule-size)] bg-border/60" />
        <ActionButton onClick={exportParts}>{t("settings.export")}</ActionButton>
        <ActionButton onClick={() => fileInputRef.current?.click()}>{t("settings.import")}</ActionButton>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {importStatus ? (
        <div className="pt-1 text-[length:var(--aries-font-size-small)] text-foreground/55">{importStatus}</div>
      ) : null}

      {editor?.mode === "add" ? (
        <ArabicPartEditor
          key="add"
          mode="add"
          part={null}
          parts={p.parts}
          terms={cat.arabicPartTerms}
          signs={cat.zodiacSigns}
          lofName={cat.lotOfFortuneName}
          onSave={addPart}
          onCancel={() => setEditor(null)}
        />
      ) : null}
      {removeAllPending ? (
        <SettingsConfirmDialog
          title={t("settings.removeArabicParts")}
          body={t("settings.removeAllPartsConfirm")}
          action={t("settings.remove")}
          onCancel={() => setRemoveAllPending(false)}
          onConfirm={confirmRemoveAll}
        />
      ) : null}
    </div>
  );
}

function ActionButton({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className="h-[var(--aries-control-height-micro)] rounded-[var(--aries-radius-xs)] border border-border/60 px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)] text-foreground/70 hover:text-foreground disabled:opacity-40 disabled:hover:text-foreground/70"
    >
      {children}
    </button>
  );
}

function SettingsConfirmDialog({
  title,
  body,
  action,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--aries-overlay-scrim)] px-[var(--aries-form-section-gap)]">
      <div
        data-aries-surface="overlay"
        className="w-full max-w-[var(--aries-dialog-width-confirm)] rounded-[var(--aries-radius-md)] border border-border bg-background p-[var(--aries-dialog-padding)] shadow-xl"
      >
        <div className="mb-[var(--aries-dialog-header-gap)] text-[length:var(--aries-font-size-large)] font-medium">{title}</div>
        <p className="text-[length:var(--aries-font-size-reading)] leading-[var(--aries-font-line-height-reading)] text-muted-foreground">{body}</p>
        <div className="mt-[var(--aries-dialog-gap)] flex justify-end gap-[var(--aries-dialog-footer-gap)]">
          <button
            type="button"
            onClick={onCancel}
            className="h-[var(--aries-control-height)] min-w-[var(--aries-control-min-width)] rounded-[var(--aries-radius-md)] border border-border px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)] text-[length:var(--aries-font-size-reading)] text-foreground/75 hover:text-foreground"
          >
            {t("settings.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-[var(--aries-control-height)] min-w-[var(--aries-control-min-width)] rounded-[var(--aries-radius-md)] bg-destructive/10 px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)] text-[length:var(--aries-font-size-reading)] text-destructive hover:bg-destructive/20"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lot-formula calculator editor — webapp twin of the wx Add/Modify surface
// (arabicpartsdlg.py ArabicPartsDlg editor block + FormulaEditorDlg). The skin
// collects raw term codes and refdeg slots; ALL formula semantics (parsing,
// formatting, validation, serialization) stay in the Python brain via
// previewArabicPart + the addPart/updatePart patch intents.
// ---------------------------------------------------------------------------

type TermMeta = { value: number; label: string; kind: "" | "RE" | "DE" };

function normalizeArabicFormulaCode(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function normalizeArabicRefTriplet(value: unknown): unknown[] {
  const source = Array.isArray(value) ? value : [0, 0, 0];
  return [0, 1, 2].map((idx) => normalizeArabicRefSlot(source[idx]));
}

function normalizeArabicRefSlot(value: unknown): ArabicRefSlot {
  if (Array.isArray(value)) {
    return [
      normalizeArabicFormulaCode(value[0]),
      normalizeArabicFormulaCode(value[1]),
      normalizeArabicFormulaCode(value[2]),
      normalizeArabicRefTriplet(value[3]),
    ];
  }
  if (typeof value === "string") return value;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function arabicRefKey(value: unknown): string {
  return JSON.stringify(normalizeArabicRefSlot(value));
}

/** Match a stored RE slot back to its picker choice — the headless twin of
 * ArabicPartsDlg._sync_inline_from_pending (arabicpartsdlg.py:1542-1588):
 * embedded tuples match a lot's embed pack, name strings match by name, legacy
 * numeric refs are dialog row indices (0 = LoF). */
function reChoiceIndexFor(
  ref: ArabicRefSlot,
  others: ArabicPartMeta[],
  allParts: ArabicPartMeta[],
): number {
  if (Array.isArray(ref)) {
    const key = arabicRefKey(ref);
    const idx = others.findIndex((o) => arabicRefKey(o.embed) === key);
    return idx >= 0 ? idx + 1 : 0;
  }
  if (typeof ref === "string") {
    const idx = others.findIndex((o) => o.name === ref);
    return idx >= 0 ? idx + 1 : 0;
  }
  const n = Number(ref);
  if (Number.isInteger(n) && n > 0) {
    // Legacy numeric refs are dialog row indices (row 0 = LoF); map row n to
    // options.arabicparts[n-1] by NAME so the self-excluded list lines up.
    const name = allParts[n - 1]?.name;
    const idx = name ? others.findIndex((o) => o.name === name) : -1;
    return idx >= 0 ? idx + 1 : 0;
  }
  return 0;
}

function ArabicPartEditor({
  mode,
  part,
  parts,
  terms,
  signs,
  lofName,
  onSave,
  onAutoSave,
  onCancel,
}: {
  mode: "add" | "edit";
  part: ArabicPartMeta | null;
  parts: ArabicPartMeta[];
  terms: TermMeta[];
  signs: string[];
  lofName: string;
  onSave: (spec: ArabicPartSpec) => void;
  onAutoSave?: (spec: ArabicPartSpec) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = React.useState(part?.name ?? "");
  const [codes, setCodes] = React.useState<number[]>(part?.codes ?? [0, 0, 0]);
  const [refdeg, setRefdeg] = React.useState<ArabicRefSlot[]>(part?.refdeg ?? [0, 0, 0]);
  const [diurnal, setDiurnal] = React.useState(
    part?.hasNocturnalFormula ? false : (part?.diurnal ?? false),
  );
  const [gendered, setGendered] = React.useState(part?.gendered ?? false);
  const [femaleOn, setFemaleOn] = React.useState(part?.hasFemaleFormula ?? false);
  const [nocturnalOn, setNocturnalOn] = React.useState(part?.hasNocturnalFormula ?? false);
  const [femaleCodes, setFemaleCodes] = React.useState<number[]>(
    part?.femaleCodes ?? part?.codes ?? [0, 0, 0],
  );
  const [femaleRefdeg, setFemaleRefdeg] = React.useState<ArabicRefSlot[]>(
    part?.femaleRefdeg ?? part?.refdeg ?? [0, 0, 0],
  );
  const [nocturnalCodes, setNocturnalCodes] = React.useState<number[]>(
    part?.nocturnalCodes ?? part?.codes ?? [0, 0, 0],
  );
  const [nocturnalRefdeg, setNocturnalRefdeg] = React.useState<ArabicRefSlot[]>(
    part?.nocturnalRefdeg ?? part?.refdeg ?? [0, 0, 0],
  );
  const [preview, setPreview] = React.useState<{
    formulaText: string;
    femaleFormulaText: string | null;
    nocturnalFormulaText: string | null;
  } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  // Other lots this row may RE-reference (no self-reference —
  // _rebuild_re_choices excludes the current row, arabicpartsdlg.py:1432-1447).
  const editPartIndex = mode === "edit" ? (part?.index ?? null) : null;
  const others = React.useMemo(
    () => parts.filter((o) => editPartIndex === null || o.index !== editPartIndex),
    [editPartIndex, parts],
  );

  // Live preview from the Python brain (the wx Formula column).
  React.useEffect(() => {
    const controller = new AbortController();
    previewArabicPart(
      {
        codes,
        refdeg,
        diurnal,
        gendered,
        femaleCodes: femaleOn ? femaleCodes : null,
        femaleRefdeg: femaleOn ? femaleRefdeg : null,
        nocturnalCodes: nocturnalOn ? nocturnalCodes : null,
        nocturnalRefdeg: nocturnalOn ? nocturnalRefdeg : null,
      },
      controller.signal,
    )
      .then((res) => {
        setPreview(res);
        setPreviewError(null);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setPreviewError(String(err));
      });
    return () => controller.abort();
  }, [
    codes,
    refdeg,
    diurnal,
    gendered,
    femaleOn,
    femaleCodes,
    femaleRefdeg,
    nocturnalOn,
    nocturnalCodes,
    nocturnalRefdeg,
  ]);

  // Name guards mirror the daemon's checkName + empty-name gate, preventing
  // invalid add saves and invalid edit autosaves before the 400 would happen.
  const trimmed = name.trim();
  const duplicate =
    trimmed === lofName || others.some((o) => o.name === trimmed);
  const canSave = trimmed.length > 0 && !duplicate;
  const spec = React.useMemo<ArabicPartSpec>(() => ({
    name: trimmed,
    codes,
    refdeg,
    diurnal: nocturnalOn ? false : diurnal,
    gendered,
    femaleCodes: femaleOn ? femaleCodes : null,
    femaleRefdeg: femaleOn ? femaleRefdeg : null,
    nocturnalCodes: nocturnalOn ? nocturnalCodes : null,
    nocturnalRefdeg: nocturnalOn ? nocturnalRefdeg : null,
    active: mode === "edit" ? (part?.active ?? true) : true,
  }), [
    trimmed,
    codes,
    refdeg,
    nocturnalOn,
    diurnal,
    gendered,
    femaleOn,
    femaleCodes,
    femaleRefdeg,
    nocturnalCodes,
    nocturnalRefdeg,
    mode,
    part?.active,
  ]);
  const specKey = React.useMemo(() => JSON.stringify(spec), [spec]);
  const lastAutoSavedKeyRef = React.useRef(specKey);

  React.useEffect(() => {
    if (mode !== "edit" || !onAutoSave || !canSave) return;
    if (lastAutoSavedKeyRef.current === specKey) return;
    const timer = window.setTimeout(() => {
      lastAutoSavedKeyRef.current = specKey;
      onAutoSave(spec);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [canSave, mode, onAutoSave, spec, specKey]);

  return (
    <div
      className={
        mode === "edit"
          ? "flex flex-col gap-[var(--aries-form-field-gap)] border-b border-border/40 bg-muted/20 px-[var(--aries-control-padding-x-compact)] py-[var(--aries-form-field-gap)]"
          : "mt-[var(--aries-form-field-gap)] flex flex-col gap-[var(--aries-form-field-gap)] rounded-[var(--aries-radius-control-compact)] border border-border/60 p-[var(--aries-form-field-gap)]"
      }
    >
      <div className="flex items-center justify-between gap-[var(--aries-form-field-gap)]">
        <span className="text-[length:var(--aries-font-size-small)] font-medium text-foreground/55">
          {mode === "edit" ? t("settings.editPart", { name: part?.name ?? "" }) : t("settings.newPart")}
        </span>
      </div>
      <div className="flex items-center gap-[var(--aries-form-field-gap)]">
        <span className="w-12 text-[length:var(--aries-font-size-small)] text-foreground/60">{t("settings.name")}</span>
        <input
          data-aries-control-appearance="local"
          type="text"
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-[var(--aries-control-height-compact)] w-[200px] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
        />
        {duplicate ? (
          <span className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-validation-error)]">{t("settings.alreadyExists")}</span>
        ) : null}
      </div>
      <FormulaSlots
        codes={codes}
        refdeg={refdeg}
        terms={terms}
        signs={signs}
        lofName={lofName}
        others={others}
        allParts={parts}
        onChange={(nextCodes, nextRefdeg) => {
          setCodes(nextCodes);
          setRefdeg(nextRefdeg);
        }}
      />
      <label className="flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] text-foreground/80">
        <Toggle checked={!nocturnalOn && diurnal} onChange={setDiurnal} disabled={nocturnalOn} />
        {t("settings.diurnalSwapBc")}
      </label>
      <label className="flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] text-foreground/80">
        <Toggle
          checked={nocturnalOn}
          onChange={setNocturnalOn}
        />
        {t("settings.separateNocturnalFormula")}
      </label>
      {nocturnalOn ? (
        <FormulaSlots
          codes={nocturnalCodes}
          refdeg={nocturnalRefdeg}
          terms={terms}
          signs={signs}
          lofName={lofName}
          others={others}
          allParts={parts}
          onChange={(nextCodes, nextRefdeg) => {
            setNocturnalCodes(nextCodes);
            setNocturnalRefdeg(nextRefdeg);
          }}
        />
      ) : null}
      <label className="flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] text-foreground/80">
        <Toggle checked={gendered} onChange={setGendered} />
        {t("settings.switchForFemale")}
      </label>
      <label className="flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] text-foreground/80">
        <Toggle checked={femaleOn} onChange={setFemaleOn} />
        {t("settings.separateFemaleFormula")}
      </label>
      {femaleOn ? (
        <FormulaSlots
          codes={femaleCodes}
          refdeg={femaleRefdeg}
          terms={terms}
          signs={signs}
          lofName={lofName}
          others={others}
          allParts={parts}
          onChange={(nextCodes, nextRefdeg) => {
            setFemaleCodes(nextCodes);
            setFemaleRefdeg(nextRefdeg);
          }}
        />
      ) : null}
      <div className="text-[length:var(--aries-font-size-small)] text-foreground/55">
        {previewError
          ? `${t("settings.previewFailed")}: ${previewError}`
          : preview
            ? `${t("settings.formula")}: ${preview.formulaText}` +
              (nocturnalOn && preview.nocturnalFormulaText
                ? ` — ${t("settings.night")}: ${preview.nocturnalFormulaText}`
                : "") +
              (femaleOn && preview.femaleFormulaText
                ? ` — ${t("settings.female")}: ${preview.femaleFormulaText}`
                : "")
            : "…"}
      </div>
      <div className="flex items-center gap-[var(--aries-control-gap)]">
        {mode === "add" ? (
          <ActionButton
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              onSave(spec);
            }}
          >
            {t("settings.save")}
          </ActionButton>
        ) : null}
        <ActionButton onClick={onCancel}>{mode === "edit" ? t("settings.close") : t("settings.cancel")}</ActionButton>
        {!canSave && trimmed.length === 0 ? (
          <span className="text-[length:var(--aries-font-size-small)] text-foreground/45">{t("settings.nameRequired")}</span>
        ) : null}
      </div>
    </div>
  );
}

/** One formula row: A + ( B - C ), each slot a term picker with RE/DE
 * sub-controls (the wx inline RE/DE rows, arabicpartsdlg.py:1064-1158, in the
 * simple native per-slot form). */
function FormulaSlots({
  codes,
  refdeg,
  terms,
  signs,
  lofName,
  others,
  allParts,
  onChange,
}: {
  codes: number[];
  refdeg: ArabicRefSlot[];
  terms: TermMeta[];
  signs: string[];
  lofName: string;
  others: ArabicPartMeta[];
  allParts: ArabicPartMeta[];
  onChange: (codes: number[], refdeg: ArabicRefSlot[]) => void;
}) {
  const ops = ["", "+ (", "−"];
  const setSlot = (i: number, code: number, ref: ArabicRefSlot) => {
    const nextCodes = codes.slice();
    const nextRef = refdeg.slice();
    nextCodes[i] = code;
    nextRef[i] = ref;
    onChange(nextCodes, nextRef);
  };
  return (
    <div className="flex flex-wrap items-start gap-[var(--aries-control-gap)]">
      {[0, 1, 2].map((i) => {
        const term = terms.find((t) => t.value === codes[i]);
        const kind = term?.kind ?? "";
        const ref = refdeg[i];
        const deAbs =
          kind === "DE" && typeof ref === "number" ? ((ref % 360) + 360) % 360 : 0;
        return (
          <React.Fragment key={i}>
            {ops[i] ? (
              <span className="pt-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-base)] text-foreground/60">{ops[i]}</span>
            ) : null}
            <span className="flex flex-col gap-[var(--aries-control-gap-compact)]">
              <Select
                value={codes[i]}
                width={110}
                onChange={(v) => {
                  // Every token change resets its refdeg slot; RE/DE slots
                  // then start at LoF / 0 Aries like the wx inline controls
                  // (_handle_token_click, arabicpartsdlg.py:1694-1695).
                  setSlot(i, Number(v), 0);
                }}
              >
                {terms.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
              {kind === "DE" ? (
                <span className="flex items-center gap-[var(--aries-control-gap-compact)]">
                  <Select
                    value={Math.floor(deAbs / 30)}
                    width={90}
                    onChange={(v) => setSlot(i, codes[i], Number(v) * 30 + (deAbs % 30))}
                  >
                    {signs.map((s, si) => (
                      <option key={s} value={si}>{s}</option>
                    ))}
                  </Select>
                  <NumberField
                    value={deAbs % 30}
                    min={0}
                    max={29}
                    onCommit={(n) => setSlot(i, codes[i], Math.floor(deAbs / 30) * 30 + n)}
                  />
                </span>
              ) : null}
              {kind === "RE" ? (
                <Select
                  value={reChoiceIndexFor(ref, others, allParts)}
                  width={130}
                  onChange={(v) => {
                    const idx = Number(v);
                    // Choice 0 = LoF (stored as legacy 0 — arabicpartsdlg.py
                    // :1653-1655); others embed that lot's formula pack.
                    setSlot(
                      i,
                      codes[i],
                      idx === 0 ? 0 : normalizeArabicRefSlot(others[idx - 1].embed),
                    );
                  }}
                >
                  <option value={0}>{lofName}</option>
                  {others.map((o, oi) => (
                    <option key={o.index} value={oi + 1}>{o.name}</option>
                  ))}
                </Select>
              ) : null}
            </span>
          </React.Fragment>
        );
      })}
      <span className="pt-1 text-[length:var(--aries-font-size-base)] text-foreground/60">)</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Almutens (almutenchartdlg.AlmutenChartDlg scoring weights). Every wx
// control round-trips; a change recalculates every chart's almuten (the daemon
// Chart.recalc fan-out subsumes horoscope.recalcAlmutens, morin.py:20876).
// The Topical-almuten definition editor (almutentopicalsdlg) is a bespoke CRUD
// list deferred separately — see the settings wiring map.
// ---------------------------------------------------------------------------

const ALMUTEN_HOUSE_LABELS = [
  "House 1", "House 2", "House 3", "House 4", "House 5", "House 6",
  "House 7", "House 8", "House 9", "House 10", "House 11", "House 12",
] as const;
const ALMUTEN_SUNPHASE_LABELS = ["Strong", "Medium", "Weak"] as const;
const ALMUTEN_DAYHOUR_LABELS = ["Day ruler", "Hour ruler"] as const;

function AlmutensTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const a = opts.almutens;
  const cat = opts.catalog;
  const sunPhaseKeys = ["settings.almutenPhaseStrong", "settings.almutenPhaseMedium", "settings.almutenPhaseWeak"];
  const dayHourKeys = ["settings.almutenDayRuler", "settings.almutenHourRuler"];

  const patch = (fields: Partial<OptionsAlmutens>) => {
    sendPatch({ almutens: fields }, { ...opts, almutens: { ...a, ...fields } });
  };
  const setVec = (
    key: "dignityscores" | "housescores" | "sunphases" | "dayhourscores",
    i: number,
    value: number,
  ) => {
    const next = a[key].slice();
    next[i] = value;
    patch({ [key]: next } as Partial<OptionsAlmutens>);
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.triplicityRulers")}</SectionLabel>
      <Row label={t("settings.rulersCounted")}>
        <Select
          value={a.oneruler ? 1 : 0}
          width={150}
          onChange={(v) => patch({ oneruler: Number(v) === 1 })}
        >
          <option value={1}>{t("settings.oneRulerDayNight")}</option>
          <option value={0}>{t("settings.allThree")}</option>
        </Select>
      </Row>
      <Row label={t("settings.useDayNightOrb")}>
        <Toggle checked={a.usedaynightorb} onChange={(v) => patch({ usedaynightorb: v })} />
      </Row>

      <SectionLabel>{t("settings.essentialDignityWeights")}</SectionLabel>
      {cat.almutenDignityLabels.map((label, i) => (
        <Row key={`dig-${i}`} label={label}>
          <NumberField value={a.dignityscores[i] ?? 0} min={0} max={5} onCommit={(n) => setVec("dignityscores", i, n)} />
        </Row>
      ))}

      <SectionLabel>{t("settings.accidentalDignity")}</SectionLabel>
      <Row label={t("settings.useAccidental")}>
        <Toggle checked={a.useaccidental} onChange={(v) => patch({ useaccidental: v })} />
      </Row>
      {ALMUTEN_HOUSE_LABELS.map((_, i) => (
        <Row key={`hc-${i}`} label={t("settings.house", { n: i + 1 })}>
          <NumberField value={a.housescores[i] ?? 0} min={0} max={12} onCommit={(n) => setVec("housescores", i, n)} />
        </Row>
      ))}

      <SectionLabel>{t("settings.sunPhaseWeights")}</SectionLabel>
      {ALMUTEN_SUNPHASE_LABELS.map((_, i) => (
        <Row key={`sun-${i}`} label={t(sunPhaseKeys[i])}>
          <NumberField value={a.sunphases[i] ?? 0} min={0} max={5} onCommit={(n) => setVec("sunphases", i, n)} />
        </Row>
      ))}

      <SectionLabel>{t("settings.dayHourRulerWeights")}</SectionLabel>
      {ALMUTEN_DAYHOUR_LABELS.map((_, i) => (
        <Row key={`dh-${i}`} label={t(dayHourKeys[i])}>
          <NumberField value={a.dayhourscores[i] ?? 0} min={0} max={10} onCommit={(n) => setVec("dayhourscores", i, n)} />
        </Row>
      ))}

      <SectionLabel>{t("settings.mercury")}</SectionLabel>
      <Row label={t("settings.useExaltationMercury")}>
        <Toggle checked={a.useexaltationmercury} onChange={(v) => patch({ useexaltationmercury: v })} />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Time Lords (Options > Time Lords: Profections + Firdaria).
// Profections flags route through {profections:{…}} (options_service
// ._apply_profections); Firdaria through {firdaria:{…}} (._apply_firdaria).
// ---------------------------------------------------------------------------

function TimeLordsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const p = opts.profections;
  const f = opts.firdaria;
  const cat = opts.catalog;

  const patchProf = (fields: Partial<typeof p>) => {
    sendPatch({ profections: fields }, { ...opts, profections: { ...p, ...fields } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.profectionChart")}</SectionLabel>
      <Row label={t("settings.method")}>
        <Select
          value={p.zodiacal ? 1 : 0}
          width={170}
          onChange={(v) => patchProf({ zodiacal: Number(v) === 1 })}
        >
          <option value={1}>{t("settings.zodiacal")}</option>
          <option value={0}>{t("settings.placidianMundane")}</option>
        </Select>
      </Row>
      <Row label={t("settings.motion")}>
        <Select
          value={p.wholeSign ? "sign" : "continuous"}
          width={170}
          onChange={(v) => patchProf({ wholeSign: v === "sign" })}
        >
          <option value="continuous">{t("settings.continuous")}</option>
          <option value="sign">{t("settings.bySign")}</option>
        </Select>
      </Row>
      <Row label={t("settings.useZodiacalProjections")}>
        <Toggle
          checked={p.useZodProjs}
          disabled={p.zodiacal}
          onChange={(v) => patchProf({ useZodProjs: v })}
        />
      </Row>
      <Row label={t("settings.snapStepsToSr")}>
        <Toggle checked={p.solarReturnSnap} onChange={(v) => patchProf({ solarReturnSnap: v })} />
      </Row>

      <SectionLabel>{t("settings.firdaria")}</SectionLabel>
      <Row label={t("settings.nocturnalOrder")}>
        <Select
          value={f.isfirbonatti ? "1" : "0"}
          width={150}
          onChange={(v) =>
            sendPatch(
              { firdaria: { isfirbonatti: v === "1" } },
              { ...opts, firdaria: { isfirbonatti: v === "1" } },
            )
          }
        >
          {cat.firdariaModes.map((m) => (
            <option key={String(m.value)} value={m.value ? "1" : "0"}>{m.label}</option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Primary Directions. Reuses the complete PrimDirSettingsBody (the faithful
// migration of primarydirsdlg.PrimDirsPanel) so the menu item opens the SAME
// surface as the directions-view Settings sheet — no rebuild.
// ---------------------------------------------------------------------------

function PrimaryDirectionsTab({ opts, sendPatch }: TabProps) {
  const s = opts.primaryDirections;
  return (
    <PrimDirSettingsBody
      settings={s}
      planetGlyphs={PD_PLANET_GLYPHS}
      presetGlobalState={{ planetsPoints: { meannode: opts.planetsPoints.meannode } }}
      onPatch={(fields, optionsPatch) =>
        sendPatch(
          { ...optionsPatch, primaryDirections: fields },
          {
            ...opts,
            primaryDirections: { ...s, ...fields },
            planetsPoints: optionsPatch?.planetsPoints
              ? { ...opts.planetsPoints, ...optionsPatch.planetsPoints }
              : opts.planetsPoints,
          },
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Tab — Eclipses (eclipse chart-moment radio, morin._set_eclipse_chart_moment_mode).
// ---------------------------------------------------------------------------

function EclipsesTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const e = opts.eclipses;
  const cat = opts.catalog;
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.eclipseChartMoment")}</SectionLabel>
      <Row label={t("settings.openEclipseChartsAt")}>
        <Select
          value={e.eclipse_chart_moment}
          width={180}
          onChange={(v) =>
            sendPatch(
              { eclipses: { eclipse_chart_moment: v } },
              { ...opts, eclipses: { eclipse_chart_moment: v } },
            )
          }
        >
          {cat.eclipseModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Fixed Stars (fixstarsdlg.FixStarsDlg which-stars picker). The active set
// is the KEY set of options.fixstars; the per-star orbs live in the Orbs tab.
// Greenfield searchable checkbox list over the full SE catalog (~1362 rows),
// windowed to visible rows + overscan for immediacy. All selection/limit/alias
// semantics are owned by the daemon (_apply_fixed_stars); this only collects the
// selectedCodes set and forwards it.
// ---------------------------------------------------------------------------

const FIXSTAR_OVERSCAN = 8;
const FIXSTAR_VIEWPORT_H = 320; // px scroll viewport
const FIXSTAR_VIRTUAL_SCROLL_SYNC_EVENT = "aries:virtual-scroll-sync";
type FixedStarSortKey = "selected" | "name" | "code" | "lon";
type FixedStarSortState = {
  key: FixedStarSortKey;
  ascending: boolean;
} | null;

function FixedStarsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const fs = opts.fixedStars;
  const [nameQuery, setNameQuery] = React.useState("");
  const [codeQuery, setCodeQuery] = React.useState("");
  const [sort, setSort] = React.useState<FixedStarSortState>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const rowHeight = useListRowHeight("dense");

  // Local optimistic selection set (the daemon is still the truth owner).
  const selected = React.useMemo(
    () => new Set(fs.selectedCodes),
    [fs.selectedCodes],
  );
  const remaining = fs.maxSelected - selected.size;

  // Search filter — name AND code substring (fixstarsdlg._filtered_indices,
  // fixstarsdlg.py:423-434). Only rows with a non-empty code are selectable.
  const visible = React.useMemo(() => {
    const nq = nameQuery.trim().toLowerCase();
    const cq = codeQuery.trim().toLowerCase();
    const filtered = fs.catalog.filter((row) => {
      if (nq && !(row.name || "").toLowerCase().includes(nq)) return false;
      if (cq && !(row.code || "").toLowerCase().includes(cq)) return false;
      return true;
    });
    return sortFixedStarRows(filtered, sort, selected);
  }, [fs.catalog, nameQuery, codeQuery, selected, sort]);

  React.useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [nameQuery, codeQuery, sort]);

  const commit = (codes: string[]) => {
    sendPatch(
      { fixedStars: { selectedCodes: codes } },
      { ...opts, fixedStars: { ...fs, selectedCodes: codes } },
    );
  };

  const toggle = (code: string) => {
    if (!code) return;
    if (selected.has(code)) {
      commit(fs.selectedCodes.filter((c) => c !== code));
      return;
    }
    // MAX_SELECTED cap (fixstarsdlg FixStarSelectionModel.toggle_row).
    if (selected.size >= fs.maxSelected) return;
    commit([...fs.selectedCodes, code]);
  };

  const deselectAll = () => commit([]);

  // Windowed slice — render only the visible rows plus overscan.
  const total = visible.length;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - FIXSTAR_OVERSCAN);
  const count = Math.ceil(FIXSTAR_VIEWPORT_H / rowHeight) + FIXSTAR_OVERSCAN * 2;
  const slice = visible.slice(first, first + count);

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const syncScrollTop = () => setScrollTop(viewport.scrollTop);
    viewport.addEventListener(FIXSTAR_VIRTUAL_SCROLL_SYNC_EVENT, syncScrollTop);
    return () => viewport.removeEventListener(FIXSTAR_VIRTUAL_SCROLL_SYNC_EVENT, syncScrollTop);
  }, []);
  useFixedRowHeightAnchor(viewportRef, total, rowHeight, {
    syncEvent: FIXSTAR_VIRTUAL_SCROLL_SYNC_EVENT,
  });

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.whichFixedStarsActive")}</SectionLabel>
      {fs.catalog.length === 0 ? (
        <div className="py-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-small)] text-foreground/45">
          {t("settings.fixStarCatalogNotFound")}
        </div>
      ) : (
        <>
          <div className="mb-[var(--aries-form-field-gap)] flex items-center gap-[var(--aries-form-field-gap)]">
            <input
              data-aries-control-appearance="local"
              type="text"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder={t("settings.searchName")}
              className="h-[var(--aries-control-height-small)] flex-1 rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-base)] outline-none focus:border-foreground/40"
            />
            <input
              data-aries-control-appearance="local"
              type="text"
              value={codeQuery}
              onChange={(e) => setCodeQuery(e.target.value)}
              placeholder={t("settings.searchNomenclature")}
              className="h-[var(--aries-control-height-small)] flex-1 rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-base)] outline-none focus:border-foreground/40"
            />
          </div>

          {/* Header row */}
          <div className="flex h-[var(--aries-control-height-compact)] items-center gap-[var(--aries-form-field-gap)] border-b border-border/60 px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-section)] font-medium text-foreground/45">
            <FixedStarSortHeader sortKey="selected" sort={sort} onSort={setSort} className="w-[var(--aries-control-height-micro)] shrink-0" ariaLabel={t("settings.sortSelected")} />
            <FixedStarSortHeader sortKey="name" sort={sort} onSort={setSort} className="min-w-0 flex-1" label={t("settings.name")} />
            <FixedStarSortHeader sortKey="code" sort={sort} onSort={setSort} className="w-24 shrink-0" label={t("settings.nomenclAbbr")} />
            <FixedStarSortHeader sortKey="lon" sort={sort} onSort={setSort} className="w-24 shrink-0" label={t("settings.longitude")} />
          </div>

          <div
            ref={viewportRef}
            className="relative overflow-y-auto"
            style={{ height: FIXSTAR_VIEWPORT_H }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <div style={{ height: total * rowHeight, position: "relative" }}>
              {slice.map((row, i) => {
                const rowIndex = first + i;
                const checked = selected.has(row.code);
                const disabled = !row.code || (!checked && remaining <= 0);
                return (
                  <div
                    key={`${row.index}-${row.code}`}
                    className="absolute left-0 right-0 flex items-center gap-[var(--aries-form-field-gap)] border-b border-border/30 px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)]"
                    style={{ top: rowIndex * rowHeight, height: rowHeight }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(row.code)}
                      className="h-3.5 w-3.5 shrink-0 accent-foreground/80 disabled:opacity-40"
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground/80">
                      {row.name || <span className="text-foreground/35">{t("settings.unnamed")}</span>}
                    </span>
                    <span className="w-24 shrink-0 truncate text-foreground/55">{row.code}</span>
                    <span className="w-24 shrink-0 truncate text-foreground/55">{row.lon}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <ActionButton onClick={deselectAll}>{t("settings.deselectAll")}</ActionButton>
            <span className="text-[length:var(--aries-font-size-small)] text-foreground/45">
              {t("settings.fixStarSelectedCount", { selected: selected.size, remaining })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function FixedStarSortHeader({
  sortKey,
  sort,
  onSort,
  className,
  label,
  ariaLabel,
}: {
  sortKey: FixedStarSortKey;
  sort: FixedStarSortState;
  onSort: React.Dispatch<React.SetStateAction<FixedStarSortState>>;
  className?: string;
  label?: string;
  ariaLabel?: string;
}) {
  const t = useT();
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? t("settings.sortBy", { label: label ?? sortKey })}
      className={`flex min-w-0 items-center gap-[var(--aries-control-gap-compact)] text-left hover:text-foreground/80 ${className ?? ""}`}
      onClick={() =>
        onSort((current) => ({
          key: sortKey,
          ascending: current?.key === sortKey ? !current.ascending : true,
        }))
      }
    >
      {label ? <span className="min-w-0 truncate">{label}</span> : null}
      {active ? (
        sort.ascending ? (
          <ArrowUp className="size-3 shrink-0" />
        ) : (
          <ArrowDown className="size-3 shrink-0" />
        )
      ) : null}
    </button>
  );
}

function sortFixedStarRows(
  rows: FixedStarCatalogRow[],
  sort: FixedStarSortState,
  selected: Set<string>,
): FixedStarCatalogRow[] {
  if (!sort) return rows;
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const cmp = compareFixedStarSortValue(
        fixedStarSortValue(a.row, sort.key, selected),
        fixedStarSortValue(b.row, sort.key, selected),
      );
      if (cmp !== 0) return sort.ascending ? cmp : -cmp;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ row }) => row);
}

function fixedStarSortValue(
  row: FixedStarCatalogRow,
  key: FixedStarSortKey,
  selected: Set<string>,
): string | number {
  if (key === "selected") return selected.has(row.code) ? 0 : 1;
  if (key === "lon") return row.lonValue;
  if (key === "code") return row.code;
  return row.name;
}

function compareFixedStarSortValue(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// ---------------------------------------------------------------------------
// Tab — Relationship Charts (compositeoptsdlg ASC method + synastry launcher
// radio, morin.py:20167-20228).
// ---------------------------------------------------------------------------

function RelationshipChartsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const r = opts.relationshipCharts;
  const cat = opts.catalog;
  const patch = (fields: Partial<typeof r>) => {
    sendPatch(
      { relationshipCharts: fields },
      { ...opts, relationshipCharts: { ...r, ...fields } },
    );
  };
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.compositeConstruction")}</SectionLabel>
      <Row label={cat.compositeMCNote}>
        <span className="text-[length:var(--aries-font-size-small)] text-foreground/45">{t("settings.fixed")}</span>
      </Row>
      <Row label={cat.compositeASCLabel}>
        <Select
          value={r.composite_method}
          width={260}
          onChange={(v) => patch({ composite_method: Number(v) })}
        >
          {cat.compositeMethods.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>

      <SectionLabel>{t("settings.launcher")}</SectionLabel>
      <Row label={t("settings.openFirst")}>
        <Select
          value={r.synastry_opens_composite_first ? "1" : "0"}
          width={180}
          onChange={(v) => patch({ synastry_opens_composite_first: v === "1" })}
        >
          {cat.relationshipLauncherModes.map((m) => (
            <option key={String(m.value)} value={m.value ? "1" : "0"}>{m.label}</option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Languages (langsdlg.LanguagesDlg). The daemon's persisted options.langid
// is canonical. Changing it rebinds mtexts, refreshes chart/inspector payloads,
// and bumps the frontend locale provider so React and native-menu labelKeys
// re-render from the same selected language.
// ---------------------------------------------------------------------------

function LanguagesTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const l = opts.languages;
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.language")}</SectionLabel>
      <Row label={t("settings.activeLanguage")}>
        <Select
          value={l.langid}
          width={180}
          onChange={(v) =>
            sendPatch(
              { languages: { langid: Number(v) } },
              { ...opts, languages: { ...l, langid: Number(v) } },
            )
          }
        >
          {l.available.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <p className="mt-2 text-[length:var(--aries-font-size-small)] leading-relaxed text-foreground/45">
        {t("settings.languageHelp")}
      </p>
    </div>
  );
}
