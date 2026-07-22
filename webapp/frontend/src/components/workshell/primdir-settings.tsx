// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { Check, Settings as SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ASPECT_GLYPHS,
  FORTUNE_GLYPH,
  PLANET_GLYPHS,
  PLANET_GLYPH_SEQUENCE,
  SE_CHIRON,
  VERTEX_GLYPH,
} from "@/lib/chart/glyphs";
import type { OptionsPatch, OptionsPrimaryDirections } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The COMPLETE Primary Directions settings panel — a faithful migration of the
// desktop primarydirsdlg.PrimDirsPanel (PrimDirsLiveFrame). Every wx control is
// present and live-committed via POST /api/options {primaryDirections:{…}}; the
// daemon owns ALL option logic. This component holds no astrological meaning —
// it renders the daemon's payload and forwards raw field patches. Glyph grids
// use the Morinus font (family 'AriesMorinus') exactly like the chart wheel.
//
// Presets are starting points, not hard locks: editing any preset field
// naturally makes the state Custom.  Where an option needs a parent mode, its
// click promotes that prerequisite in the same patch instead of reproducing
// the wx dialog's disabled-control maze.
// ---------------------------------------------------------------------------

// primdirs.py:92-96 — house systems.
const PD_SYSTEMS = [
  { value: 0, label: "Placidus (Semiarc)" },
  { value: 1, label: "Placidus (under the pole)" },
  { value: 2, label: "Regiomontanus" },
  { value: 3, label: "Campanus" },
  { value: 4, label: "Topocentric (Polich-Page)" },
] as const;

// primdirs.py:102-104 — Mundane / Zodiacal / Both.
const PD_SUBMODES = [
  { value: 0, label: "Mundane" },
  { value: 1, label: "Zodiacal" },
  { value: 2, label: "Both" },
] as const;

// primdirs.py:107-110 — Use Latitude of (subzodiacal).
const PD_SZ = [
  { value: 0, label: "Neither" },
  { value: 1, label: "Promissor" },
  { value: 2, label: "Significator" },
  { value: 3, label: "Both" },
] as const;

// promplanets / sigplanets index order (common.Planets Sun..S.Node).
export const PD_PLANET_GLYPHS = PLANET_GLYPH_SEQUENCE;
const PD_PLANET_NAMES = [
  "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter",
  "Saturn", "Uranus", "Neptune", "Pluto", "Asc Node", "Dsc Node",
] as const;

// primarydirsdlg.py:318-328 — Asc / Dsc / MC / IC sig angle glyphs (chart house
// angle chars: common.py house glyphs I / VII / X / IV). Render the cardinal
// labels as text since the desktop labels them with mtexts (Asc/Dsc/MC/IC).
const PD_ANGLE_NAMES = ["Asc", "Dsc", "MC", "IC"] as const;

// primarydirsdlg.py:238-265 — aspect grid: 12 pdaspects (Conjunction..Septile)
// then 2 pdparallels (Parallel, RaptParallel). Glyph slots from ASPECT_GLYPHS;
// RaptParallel is synthetic (chart.py:473) with no Morinus slot → text label.
const PD_ASPECTS = [
  { name: "Conjunction", glyph: ASPECT_GLYPHS[0] },
  { name: "Semisextile", glyph: ASPECT_GLYPHS[1] },
  { name: "Semisquare", glyph: ASPECT_GLYPHS[2] },
  { name: "Sextile", glyph: ASPECT_GLYPHS[3] },
  { name: "Quintile", glyph: ASPECT_GLYPHS[4] },
  { name: "Square", glyph: ASPECT_GLYPHS[5] },
  { name: "Trine", glyph: ASPECT_GLYPHS[6] },
  { name: "Sesquisquare", glyph: ASPECT_GLYPHS[7] },
  { name: "Biquintile", glyph: ASPECT_GLYPHS[8] },
  { name: "Quincunx", glyph: ASPECT_GLYPHS[9] },
  { name: "Opposition", glyph: ASPECT_GLYPHS[10] },
  { name: "Septile", glyph: ASPECT_GLYPHS[11] },
] as const;
const PD_PARALLELS = [
  { name: "Parallel", glyph: ASPECT_GLYPHS[12] }, // common.py:368 parallel slot
  { name: "Rapt Parallel", glyph: "" }, // synthetic, no glyph slot
] as const;

// primarydirsdlg.py:189 mtexts.smiterList — Sec.Motion iteration count.
const SMITER_LABEL_KEYS = [
  "primdir.iteration1",
  "primdir.iteration2",
  "primdir.iteration3",
] as const;

// mtexts.typeListStat / typeListDyn (resolved via setLang(0)).
const KEY_STAT_LABEL_KEYS = [
  "primdir.keyNaibod",
  "primdir.keyCardan",
  "primdir.keyPtolemy",
  "primdir.keyUserP",
] as const;
const KEY_DYN_LABEL_KEYS = [
  "primdir.keyTrueSolarEquatorial",
  "primdir.keyTrueSolarEquatorialBirthday",
  "primdir.keyTrueSolarEcliptical",
  "primdir.keyTrueSolarEclipticalBirthday",
] as const;
const KEY_CUSTOMER_IDX = 3; // primdirs.py:130 PrimDirs.CUSTOMER

// Display-label i18n keys for the radio/grid constants defined above. The
// English/values live in the constants; these carry the translated captions.
const PD_SYSTEM_LABEL_KEYS = [
  "primdir.systemPlacidusSemiarc",
  "primdir.systemPlacidusPole",
  "primdir.systemRegiomontanus",
  "primdir.systemCampanus",
  "primdir.systemTopocentric",
] as const;
const PD_SUBMODE_LABEL_KEYS = [
  "primdir.modeMundane",
  "primdir.modeZodiacal",
  "primdir.modeBoth",
] as const;
const PD_SZ_LABEL_KEYS = [
  "primdir.szNeither",
  "primdir.szPromissor",
  "primdir.szSignificator",
  "primdir.latitudeBoth",
] as const;
const PD_PLANET_LABEL_KEYS = [
  "primdir.planetSun",
  "primdir.planetMoon",
  "primdir.planetMercury",
  "primdir.planetVenus",
  "primdir.planetMars",
  "primdir.planetJupiter",
  "primdir.planetSaturn",
  "primdir.planetUranus",
  "primdir.planetNeptune",
  "primdir.planetPluto",
  "primdir.planetAscNode",
  "primdir.planetDscNode",
] as const;
const PD_ANGLE_LABEL_KEYS = [
  "primdir.angleAsc",
  "primdir.angleDsc",
  "primdir.angleMC",
  "primdir.angleIC",
] as const;
const PD_ASPECT_LABEL_KEYS = [
  "primdir.aspectConjunction",
  "primdir.aspectSemisextile",
  "primdir.aspectSemisquare",
  "primdir.aspectSextile",
  "primdir.aspectQuintile",
  "primdir.aspectSquare",
  "primdir.aspectTrine",
  "primdir.aspectSesquisquare",
  "primdir.aspectBiquintile",
  "primdir.aspectQuincunx",
  "primdir.aspectOpposition",
  "primdir.aspectSeptile",
] as const;
// Engine-preset display keys (id → label / description).
const PRESET_LABEL_KEYS: Record<string, string> = {
  morin: "primdir.presetMorin",
  topocentric: "primdir.presetTopocentric",
  ptolemy: "primdir.keyPtolemy",
};
const PRESET_DESC_KEYS: Record<string, string> = {
  morin: "primdir.morinDescription",
  topocentric: "primdir.topocentricDescription",
  ptolemy: "primdir.ptolemyDescription",
};

type Patch = Partial<OptionsPrimaryDirections>;

type PrimaryDirectionPreset = {
  id: string;
  label: string;
  description: string;
  patch: Patch;
  buildPatch?: (settings: OptionsPrimaryDirections) => Patch;
  optionsPatch?: OptionsPatch;
};

type PresetGlobalState = {
  planetsPoints?: {
    meannode?: boolean;
  };
};

const allBools = (length: number, value: boolean) => Array.from({ length }, () => value);
const CORE_7 = [true, true, true, true, true, true, true, false, false, false, false, false];
const ALL_PLANETS = allBools(12, true);
const ALL_ANGLES = allBools(4, true);
const TOPOCENTRIC_FACTORS = [
  true, true, true, true, true, true, true, true, true, true, true, false,
];
const MAJOR_ASPECTS = [
  true, // Conjunction
  false,
  false,
  true, // Sextile
  false,
  true, // Square
  true, // Trine
  false,
  false,
  false,
  true, // Opposition
  false,
];
const TOPOCENTRIC_ASPECTS = [
  true, // Conjunction
  true, // Semisextile
  true, // Semisquare
  true, // Sextile
  false,
  true, // Square
  true, // Trine
  true, // Sesquisquare
  false,
  true, // Quincunx
  true, // Opposition
  false,
];
const MORIN_ACCEPTED_ASPECTS = [
  true, // Conjunction
  true, // Semisextile / dodectile
  false,
  true, // Sextile
  false,
  true, // Square
  true, // Trine
  false,
  false,
  true, // Quincunx
  true, // Opposition
  false,
];
const FULL_ASPECTS = allBools(12, true);
// Morin uses fixed stars as promissors. Keep the preset source-strict by
// selecting stars explicitly named in his direction examples / doctrine notes
// when they exist in the active catalog: Spica, Algol, Aldebaran, Regulus,
// and Alcyone/Pleiades.
const MORIN_PD_FIXED_STAR_CODES = new Set(["alVir", "bePer", "alTau", "alLeo", "etTau"]);

const PRIMARY_ENGINE_PRESET_BASE: Patch = {
  subprimarydir: 2,
  subzodiacal: 3,
  bianchini: false,
  morin_excentric: false,
  morin_antiscia: false,
  zodpromsigasps: [true, true],
  ascmchcsasproms: true,
  pdcusppromissors: false,
  promplanets: ALL_PLANETS,
  pdantiscia: false,
  pdmorinpromittorset: false,
  pdmidpoints: false,
  pdterms: true,
  pdfixstars: false,
  pdsecmotion: false,
  pdsecmotioniter: 0,
  pdpromchiron: true,
  pdpromarabicparts: false,
  promlof: true,
  pdcustomer: false,
  pdcustomersouthern: false,
  pdaspects: FULL_ASPECTS,
  pdparallels: [true, false],
  sigangles: ALL_ANGLES,
  sighouses: true,
  sigplanets: ALL_PLANETS,
  siglof: true,
  pdsyzygy: true,
  pdsigchiron: true,
  pdsigvertex: false,
  pdsigarabicparts: false,
  pdcustomer2: false,
  pdcustomer2southern: false,
  pdcircumoa: 1,
  pdrevsunyearmode: 0,
  pdrevannualmode: 0,
  pdkeydyn: false,
  pdkeyd: 0,
  pdkeys: 0,
  useregressive: false,
};

function presetPatch(overrides: Patch): Patch {
  const patch = { ...PRIMARY_ENGINE_PRESET_BASE, ...overrides };
  return {
    ...patch,
    zodpromsigasps: patch.zodpromsigasps?.slice(),
    promplanets: patch.promplanets?.slice(),
    pdaspects: patch.pdaspects?.slice(),
    pdparallels: patch.pdparallels?.slice(),
    pdfixstarssel: patch.pdfixstarssel?.slice(),
    sigangles: patch.sigangles?.slice(),
    sigplanets: patch.sigplanets?.slice(),
  };
}

function morinFixedStarPatch(settings: OptionsPrimaryDirections): Patch {
  const currentSelection = Array.isArray(settings.pdfixstarssel) ? settings.pdfixstarssel : [];
  const catalog = Array.isArray(settings.pdFixStarCatalog) ? settings.pdFixStarCatalog : [];
  const selectionLength = Math.max(
    currentSelection.length,
    ...catalog.map((entry) => entry.ordinal + 1),
    0,
  );
  const selection = Array.from({ length: selectionLength }, () => false);
  for (const entry of catalog) {
    if (MORIN_PD_FIXED_STAR_CODES.has(entry.code) && entry.ordinal < selection.length) {
      selection[entry.ordinal] = true;
    }
  }
  return {
    pdfixstars: selection.some(Boolean),
    pdfixstarssel: selection,
  };
}

const PRIMARY_DIRECTION_PRESETS: PrimaryDirectionPreset[] = [
  {
    id: "morin",
    label: "Morin",
    description: "Seven planets, Fortuna, fixed stars, Morin aspect rays, and declination antiscia only.",
    patch: presetPatch({
      primarydir: 2,
      subprimarydir: 1,
      subzodiacal: 3,
      bianchini: false,
      morin_excentric: true,
      morin_antiscia: true,
      zodpromsigasps: [true, false],
      ascmchcsasproms: false,
      promplanets: CORE_7,
      pdantiscia: true,
      pdmorinpromittorset: true,
      pdmidpoints: false,
      pdterms: false,
      pdpromchiron: false,
      pdpromarabicparts: false,
      promlof: true,
      pdaspects: MORIN_ACCEPTED_ASPECTS,
      pdparallels: [false, false],
      sigangles: ALL_ANGLES,
      sighouses: true,
      sigplanets: CORE_7,
      siglof: true,
      pdsyzygy: false,
      pdsigchiron: false,
      pdsigvertex: false,
      pdsigarabicparts: false,
    }),
    buildPatch: morinFixedStarPatch,
  },
  {
    id: "topocentric",
    label: "Topocentric",
    description: "Marr/Estadella Topocentric directions with Naibod key and supported aspects only.",
    patch: presetPatch({
      primarydir: 4,
      subprimarydir: 1,
      subzodiacal: 2,
      bianchini: false,
      zodpromsigasps: [true, true],
      // Angles act as significators (planets' aspect rays are directed TO the
      // ASC/MC via "Aspects of Promissors to Significators"). Directing the
      // angles AS promissors only re-emits those same alignments relabeled
      // (plus angle<->angle/cusp cross-directions), so it is left OFF for the
      // predictive preset. It belongs to the rectification profile, where Marr
      // frames the search as "directing the MC, ASC, and house cusps."
      ascmchcsasproms: false,
      promplanets: TOPOCENTRIC_FACTORS,
      pdantiscia: false,
      pdmidpoints: false,
      pdterms: false,
      pdfixstars: false,
      pdsecmotion: false,
      pdpromchiron: false,
      pdpromarabicparts: false,
      promlof: true,
      pdaspects: TOPOCENTRIC_ASPECTS,
      pdparallels: [true, false],
      sigangles: ALL_ANGLES,
      sighouses: true,
      sigplanets: TOPOCENTRIC_FACTORS,
      siglof: true,
      pdsyzygy: false,
      pdsigchiron: false,
      pdsigvertex: false,
      pdsigarabicparts: false,
      pdcustomer: false,
      pdcustomer2: false,
    }),
    optionsPatch: { planetsPoints: { meannode: true } },
  },
  {
    id: "ptolemy",
    label: "Ptolemy",
    description: "Classical promissors to Sun, Moon, Asc, MC, and Fortuna with Ptolemy key.",
    patch: presetPatch({
      primarydir: 0,
      subprimarydir: 1,
      subzodiacal: 0,
      zodpromsigasps: [true, false],
      ascmchcsasproms: false,
      promplanets: CORE_7,
      pdterms: false,
      pdpromchiron: false,
      pdpromarabicparts: false,
      promlof: false,
      pdaspects: MAJOR_ASPECTS,
      pdparallels: [false, false],
      sigangles: [true, false, true, false],
      sighouses: false,
      sigplanets: [true, true, false, false, false, false, false, false, false, false, false, false],
      siglof: true,
      pdsyzygy: false,
      pdsigchiron: false,
      pdsigvertex: false,
      pdkeys: 2,
    }),
  },
];

function patchValueEquals(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((value, index) => actual[index] === value);
  }
  return actual === expected;
}

function presetOptionsPatchMatches(globalState: PresetGlobalState | undefined, optionsPatch: OptionsPatch | undefined) {
  if (!optionsPatch?.planetsPoints) return true;
  const expectedMeanNode = optionsPatch.planetsPoints.meannode;
  if (expectedMeanNode !== undefined) {
    return globalState?.planetsPoints?.meannode === expectedMeanNode;
  }
  return true;
}

function presetMatchesSettings(
  settings: OptionsPrimaryDirections,
  preset: PrimaryDirectionPreset,
  globalState?: PresetGlobalState,
): boolean {
  const patch = presetResolvedPatch(preset, settings);
  const primaryMatches = Object.entries(patch).every(([key, expected]) => {
    if (expected === undefined) return true;
    return patchValueEquals(settings[key as keyof OptionsPrimaryDirections], expected);
  });
  return primaryMatches && presetOptionsPatchMatches(globalState, preset.optionsPatch);
}

function activePrimaryDirectionPreset(
  settings: OptionsPrimaryDirections,
  globalState?: PresetGlobalState,
): PrimaryDirectionPreset | null {
  return PRIMARY_DIRECTION_PRESETS.find((preset) => presetMatchesSettings(settings, preset, globalState)) ?? null;
}

function presetResolvedPatch(preset: PrimaryDirectionPreset, settings: OptionsPrimaryDirections): Patch {
  return {
    ...preset.patch,
    ...(preset.buildPatch?.(settings) ?? {}),
  };
}

function presetResolvedOptionsPatch(preset: PrimaryDirectionPreset): OptionsPatch | undefined {
  return preset.optionsPatch;
}

function GlyphCheck({
  glyph,
  textGlyph,
  label,
  checked,
  disabled,
  className,
  onToggle,
}: {
  glyph?: string;
  textGlyph?: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs",
        "hover:bg-accent disabled:opacity-40 disabled:pointer-events-none",
        checked ? "bg-accent/60" : "",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-xs border text-[length:var(--aries-font-size-section)]",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {checked ? "✓" : ""}
      </span>
      {glyph ? (
        <span className="font-symbols w-4 text-center text-[length:var(--aries-font-size-large)] leading-none">
          {glyph}
        </span>
      ) : textGlyph ? (
        <span className="w-4 text-center text-[length:var(--aries-font-size-base)] leading-none">{textGlyph}</span>
      ) : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

function PlainCheck({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <GlyphCheck label={label} checked={checked} disabled={disabled} onToggle={onToggle} />
  );
}

function RadioRow<T extends number>({
  options,
  value,
  disabled,
  disabledValues,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  disabledValues?: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {options.map((o) => {
        const optionDisabled = disabled || disabledValues?.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={optionDisabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs",
              "hover:bg-accent disabled:opacity-40 disabled:pointer-events-none",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border",
                value === o.value ? "border-primary" : "border-border",
              )}
            >
              {value === o.value ? (
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              ) : null}
            </span>
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 text-[length:var(--aries-font-size-small)] font-semibold text-muted-foreground">
      {children}
    </div>
  );
}

function SmallNumberInput({
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <Input
      key={value}
      type="number"
      min={min}
      max={max}
      defaultValue={value}
      disabled={disabled}
      className="h-6 w-14 px-1 text-right text-[length:var(--aries-font-size-small)]"
      onBlur={(event) => {
        let next = Number(event.target.value);
        if (!Number.isFinite(next)) {
          event.target.value = String(value);
          return;
        }
        next = Math.max(min, Math.min(max, Math.round(next)));
        if (next !== value) onCommit(next);
        else event.target.value = String(value);
      }}
    />
  );
}

function CustomerPointBlock({
  title,
  enabled,
  lon,
  lat,
  southern,
  onPatch,
  enabledKey,
  lonKey,
  latKey,
  southernKey,
}: {
  title: string;
  enabled: boolean;
  lon: number[];
  lat: number[];
  southern: boolean;
  onPatch: (patch: Patch) => void;
  enabledKey: "pdcustomer" | "pdcustomer2";
  lonKey: "pdcustomerlon" | "pdcustomer2lon";
  latKey: "pdcustomerlat" | "pdcustomer2lat";
  southernKey: "pdcustomersouthern" | "pdcustomer2southern";
}) {
  const t = useT();
  const setTriple = (key: typeof lonKey | typeof latKey, values: number[], index: number, value: number) => {
    const next = values.slice(0, 3);
    next[index] = value;
    onPatch({ [key]: next } as Patch);
  };

  return (
    <div className="mt-1 rounded border border-border/60 p-2">
      <PlainCheck
        label={title}
        checked={enabled}
        onToggle={() => onPatch({ [enabledKey]: !enabled } as Patch)}
      />
      <div className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
        <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{t("primdir.lon")}</span>
        <span className="flex items-center gap-1">
          <SmallNumberInput value={lon[0] ?? 0} min={0} max={359} disabled={!enabled} onCommit={(v) => setTriple(lonKey, lon, 0, v)} />
          <SmallNumberInput value={lon[1] ?? 0} min={0} max={59} disabled={!enabled} onCommit={(v) => setTriple(lonKey, lon, 1, v)} />
          <SmallNumberInput value={lon[2] ?? 0} min={0} max={59} disabled={!enabled} onCommit={(v) => setTriple(lonKey, lon, 2, v)} />
        </span>
        <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{t("primdir.lat")}</span>
        <span className="flex items-center gap-1">
          <SmallNumberInput value={lat[0] ?? 0} min={0} max={90} disabled={!enabled} onCommit={(v) => setTriple(latKey, lat, 0, v)} />
          <SmallNumberInput value={lat[1] ?? 0} min={0} max={59} disabled={!enabled} onCommit={(v) => setTriple(latKey, lat, 1, v)} />
          <SmallNumberInput value={lat[2] ?? 0} min={0} max={59} disabled={!enabled} onCommit={(v) => setTriple(latKey, lat, 2, v)} />
        </span>
      </div>
      <div className="mt-1">
        <PlainCheck
          label={t("primdir.southernLatitude")}
          checked={southern}
          disabled={!enabled}
          onToggle={() => onPatch({ [southernKey]: !southern } as Patch)}
        />
      </div>
    </div>
  );
}

export function PrimDirSettingsSheet({
  settings,
  planetGlyphs = PD_PLANET_GLYPHS,
  presetGlobalState,
  onPatch,
}: {
  settings: OptionsPrimaryDirections | null;
  planetGlyphs?: readonly string[];
  presetGlobalState?: PresetGlobalState;
  onPatch: (patch: Patch, optionsPatch?: OptionsPatch) => void;
}) {
  const t = useT();
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-6 px-1.5 text-xs"
            aria-label={t("primdir.settingsTitle")}
            title={t("primdir.settingsTitle")}
          >
            <SettingsIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        }
      />
      <SheetContent side="right" size="lg" className="p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm">{t("primdir.settingsTitle")}</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-3.25rem)]">
          {settings == null ? (
            <div className="px-4 py-6 text-xs text-muted-foreground">{t("primdir.loading")}</div>
          ) : (
            <PrimDirSettingsBody
              settings={settings}
              planetGlyphs={planetGlyphs}
              presetGlobalState={presetGlobalState}
              onPatch={onPatch}
            />
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// --- Fixed-Star PD selection picker (the fixstarspddlg.FixStarsPDDlg sub-dialog,
// fixstarspddlg.py). The desktop opens a modal checklist of the catalog stars
// with name/code filtering, Select/Deselect All, and a 200-star cap
// (FixStarPDSelectionModel.MAX_SELECTED). Here it is an inline picker that
// commits pdfixstarssel live through the same options patch; the daemon supplies
// the catalog (ordinal/code/name) and enforces the same parallel-bool contract
// consumed by primdirs._pd_fixstar_selected (primdirs.py:497-511).
function FixStarPdPicker({
  catalog,
  selection,
  maxSelected,
  disabled,
  onPatch,
}: {
  catalog: OptionsPrimaryDirections["pdFixStarCatalog"];
  selection: boolean[];
  maxSelected: number;
  disabled?: boolean;
  onPatch: (patch: Patch) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [nameQuery, setNameQuery] = React.useState("");
  const [codeQuery, setCodeQuery] = React.useState("");

  const sel = React.useMemo(() => {
    const out = catalog.map((entry) => !!selection[entry.ordinal]);
    return out;
  }, [catalog, selection]);
  const selectedCount = sel.filter(Boolean).length;
  const remaining = Math.max(0, maxSelected - selectedCount);

  const commit = React.useCallback(
    (next: boolean[]) => {
      // pdfixstarssel is indexed by catalog ordinal; rebuild the full list.
      const full = selection.slice();
      catalog.forEach((entry, i) => {
        full[entry.ordinal] = next[i];
      });
      onPatch({ pdfixstarssel: full });
    },
    [catalog, onPatch, selection],
  );

  const toggle = (i: number) => {
    const next = sel.slice();
    if (!next[i] && selectedCount >= maxSelected) return; // cap (set_selected:88-97)
    next[i] = !next[i];
    commit(next);
  };
  const selectAll = () => {
    // FixStarPDSelectionModel.select_all caps at MAX_SELECTED (:102-106).
    let count = 0;
    const next = catalog.map(() => {
      if (count >= maxSelected) return false;
      count += 1;
      return true;
    });
    commit(next);
  };
  const deselectAll = () => commit(catalog.map(() => false));

  const nq = nameQuery.trim().toLowerCase();
  const cq = codeQuery.trim().toLowerCase();
  const visible = catalog
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => {
      if (nq && !entry.name.toLowerCase().includes(nq)) return false;
      if (cq && !entry.code.toLowerCase().includes(cq)) return false;
      return true;
    });

  return (
    <div className="ml-6 mt-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="text-[length:var(--aries-font-size-small)] text-primary hover:underline disabled:opacity-40 disabled:pointer-events-none"
      >
        {open ? t("primdir.hide") : t("primdir.selectStars")} {t("primdir.selectedCount", { count: selectedCount })}
      </button>
      {open ? (
        <div className="mt-1 rounded border border-border p-2">
          <div className="mb-1 flex items-center gap-1.5">
            <Input
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder={t("primdir.placeholderName")}
              className="h-6 text-[length:var(--aries-font-size-small)]"
            />
            <Input
              value={codeQuery}
              onChange={(e) => setCodeQuery(e.target.value)}
              placeholder={t("primdir.placeholderCode")}
              className="h-6 text-[length:var(--aries-font-size-small)]"
            />
          </div>
          <div className="mb-1 flex items-center justify-between text-[length:var(--aries-font-size-section)] text-muted-foreground">
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[length:var(--aries-font-size-section)]" onClick={deselectAll}>
                {t("primdir.deselectAll")}
              </Button>
              <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[length:var(--aries-font-size-section)]" onClick={selectAll}>
                {t("primdir.selectAll")}
              </Button>
            </div>
            <span>{t("primdir.starsLeft", { count: remaining })}</span>
          </div>
          <ScrollArea className="h-40">
            <div className="flex flex-col">
              {visible.map(({ entry, i }) => (
                <GlyphCheck
                  key={entry.code}
                  label={`${entry.name} (${entry.code})`}
                  checked={sel[i]}
                  onToggle={() => toggle(i)}
                />
              ))}
              {visible.length === 0 ? (
                <span className="px-1.5 py-1 text-[length:var(--aries-font-size-small)] text-muted-foreground">{t("primdir.noStars")}</span>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}

function EnginePresetPicker({
  settings,
  presetGlobalState,
  onPatch,
}: {
  settings: OptionsPrimaryDirections;
  presetGlobalState?: PresetGlobalState;
  onPatch: (patch: Patch, optionsPatch?: OptionsPatch) => void;
}) {
  const t = useT();
  const activePreset = activePrimaryDirectionPreset(settings, presetGlobalState);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <SectionLabel>{t("primdir.enginePreset")}</SectionLabel>
        {activePreset == null ? (
          <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{t("primdir.custom")}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded border border-border/70 bg-muted/20 p-1">
        {PRIMARY_DIRECTION_PRESETS.map((preset) => {
          const selected = preset.id === activePreset?.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={t(PRESET_DESC_KEYS[preset.id] ?? preset.description)}
              aria-pressed={selected}
              onClick={() => onPatch(presetResolvedPatch(preset, settings), presetResolvedOptionsPatch(preset))}
              className={cn(
                "flex h-7 min-w-0 items-center justify-center gap-1 rounded px-2 text-[length:var(--aries-font-size-small)] leading-none hover:bg-muted",
                selected && "bg-muted text-foreground",
              )}
            >
              <span className="h-3.5 w-3.5 shrink-0">
                {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              </span>
              <span className="min-w-0 truncate font-medium">{t(PRESET_LABEL_KEYS[preset.id] ?? preset.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PrimDirSettingsBody({
  settings: s,
  planetGlyphs,
  presetGlobalState,
  onPatch,
}: {
  settings: OptionsPrimaryDirections;
  planetGlyphs: readonly string[];
  presetGlobalState?: PresetGlobalState;
  onPatch: (patch: Patch, optionsPatch?: OptionsPatch) => void;
}) {
  const t = useT();
  const isPlacidianSemiarc = s.primarydir === 0;
  const zodiacalActive = s.subprimarydir === 1 || s.subprimarydir === 2; // Zodiacal|Both
  // RaptParallel only on Placidian Semiarc (onPlacidian:542).
  const raptEnabled = isPlacidianSemiarc;

  const withZodiacalMode = (patch: Patch): Patch => (
    zodiacalActive ? patch : { subprimarydir: 2, ...patch }
  );
  const withBothLatitudes = (patch: Patch): Patch => ({
    ...(zodiacalActive ? {} : { subprimarydir: 2 }),
    subzodiacal: 3,
    ...patch,
  });

  const toggleVec = (attr: keyof OptionsPrimaryDirections, i: number) => {
    const cur = (s[attr] as boolean[]).slice();
    cur[i] = !cur[i];
    onPatch({ [attr]: cur } as Patch);
  };
  // Promissors grid Deselect/Select All (primarydirsdlg.py:1266-1288): clears/
  // sets promplanets + antiscia/midpoints/lof/terms/fixstars (+ secmotion gate).
  const promSelectAll = (val: boolean) => {
    onPatch({
      promplanets: s.promplanets.map(() => val),
      pdantiscia: val,
      pdmidpoints: val,
      promlof: val,
      pdterms: val,
      pdfixstars: val,
      pdpromarabicparts: val,
    });
  };
  // Aspects Deselect/Select All (:1290-1309): pdaspects + pdparallels.
  const aspSelectAll = (val: boolean) => {
    onPatch({
      pdaspects: s.pdaspects.map(() => val),
      pdparallels: s.pdparallels.map(() => val),
    });
  };
  // Significators Deselect/Select All: angles + houses + planets + point toggles.
  const sigSelectAll = (val: boolean) => {
    onPatch({
      sigangles: s.sigangles.map(() => val),
      sighouses: val,
      sigplanets: s.sigplanets.map(() => val),
      siglof: val,
      pdsyzygy: val,
      pdsigvertex: val,
      pdsigchiron: val,
      pdsigarabicparts: val,
    });
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <EnginePresetPicker settings={s} presetGlobalState={presetGlobalState} onPatch={onPatch} />

      {/* Keys block */}
      <KeysBlock settings={s} onPatch={onPatch} />

      <Separator />

      {/* House system */}
      <div>
        <SectionLabel>{t("primdir.houseSystem")}</SectionLabel>
        <RadioRow
          options={PD_SYSTEMS.map((o, i) => ({ value: o.value, label: t(PD_SYSTEM_LABEL_KEYS[i]) }))}
          value={s.primarydir}
          onChange={(v) =>
            onPatch(v === 1 ? { primarydir: v, subprimarydir: 1 } : { primarydir: v })
          }
        />
      </div>

      <Separator />

      {/* Mundane / Zodiacal / Both */}
      <div>
        <SectionLabel>{t("primdir.sectionMode")}</SectionLabel>
        <RadioRow
          options={PD_SUBMODES.map((o, i) => ({ value: o.value, label: t(PD_SUBMODE_LABEL_KEYS[i]) }))}
          value={s.subprimarydir}
          onChange={(v) => onPatch({ subprimarydir: v })}
        />
      </div>

      {/* Use Latitude of */}
      <div>
        <SectionLabel>{t("primdir.useLatitudeOf")}</SectionLabel>
        <RadioRow
          options={PD_SZ.map((o, i) => ({ value: o.value, label: t(PD_SZ_LABEL_KEYS[i]) }))}
          value={s.subzodiacal}
          onChange={(v) => onPatch(withZodiacalMode({ subzodiacal: v }))}
        />
        <div className="ml-4 mt-0.5 flex flex-col">
          <PlainCheck
            label={t("primdir.bianchini")}
            checked={s.bianchini}
            onToggle={() => onPatch(withBothLatitudes({ bianchini: !s.bianchini }))}
          />
          <PlainCheck
            label={t("primdir.morinExcentric")}
            checked={s.morin_excentric}
            onToggle={() => onPatch(withBothLatitudes({ morin_excentric: !s.morin_excentric }))}
          />
          <PlainCheck
            label={t("primdir.morinAntiscia")}
            checked={s.morin_antiscia}
            onToggle={() => onPatch({ morin_antiscia: !s.morin_antiscia })}
          />
        </div>
      </div>

      {/* Zodiacal options */}
      <div>
        <SectionLabel>{t("primdir.zodiacalOptions")}</SectionLabel>
        <div className="flex flex-col">
          <PlainCheck
            label={t("primdir.aspectsPromsToSigs")}
            checked={!!s.zodpromsigasps[0]}
            onToggle={() => {
              const next = s.zodpromsigasps.slice();
              next[0] = !next[0];
              onPatch(withZodiacalMode({ zodpromsigasps: next }));
            }}
          />
          <PlainCheck
            label={t("primdir.promsToAspectsSigs")}
            checked={!!s.zodpromsigasps[1]}
            onToggle={() => {
              const next = s.zodpromsigasps.slice();
              next[1] = !next[1];
              onPatch(withZodiacalMode({ zodpromsigasps: next }));
            }}
          />
          <PlainCheck
            label={t("primdir.ascMcAsProms")}
            checked={s.ascmchcsasproms}
            onToggle={() => onPatch(withZodiacalMode({ ascmchcsasproms: !s.ascmchcsasproms }))}
          />
          <PlainCheck
            label={t("primdir.cuspsAsProms")}
            checked={s.pdcusppromissors}
            onToggle={() => onPatch(withZodiacalMode({ pdcusppromissors: !s.pdcusppromissors }))}
          />
        </div>
      </div>

      <Separator />

      {/* Promissors grid */}
      <div>
        <div className="flex items-center justify-between">
          <SectionLabel>{t("primdir.promissors")}</SectionLabel>
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[length:var(--aries-font-size-section)]" onClick={() => promSelectAll(false)}>
              {t("primdir.deselectAll")}
            </Button>
            <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[length:var(--aries-font-size-section)]" onClick={() => promSelectAll(true)}>
              {t("primdir.selectAll")}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-2">
          {PD_PLANET_NAMES.map((name, i) => (
            <GlyphCheck
              key={name}
              glyph={planetGlyphs[i] ?? PD_PLANET_GLYPHS[i]}
              label={t(PD_PLANET_LABEL_KEYS[i])}
              checked={!!s.promplanets[i]}
              onToggle={() => toggleVec("promplanets", i)}
            />
          ))}
          <div className="flex flex-col">
            <GlyphCheck label={t("primdir.antiscia")} checked={s.pdantiscia} onToggle={() => onPatch({ pdantiscia: !s.pdantiscia })} />
            <GlyphCheck
              label={t("primdir.conjOnlyNoCa")}
              checked={s.pdmorinpromittorset}
              className="ml-6 text-[length:var(--aries-font-size-small)]"
              onToggle={() => onPatch(s.pdantiscia
                ? { pdmorinpromittorset: !s.pdmorinpromittorset }
                : { pdantiscia: true, pdmorinpromittorset: true })}
            />
          </div>
          <GlyphCheck label={t("primdir.midpoints")} checked={s.pdmidpoints} onToggle={() => onPatch({ pdmidpoints: !s.pdmidpoints })} />
          <GlyphCheck glyph={FORTUNE_GLYPH} label={t("primdir.fortunaLof")} checked={s.promlof} onToggle={() => onPatch(withZodiacalMode({ promlof: !s.promlof }))} />
          <GlyphCheck label={t("primdir.terms")} checked={s.pdterms} onToggle={() => onPatch(withZodiacalMode({ pdterms: !s.pdterms }))} />
          <GlyphCheck label={t("primdir.fixedStars")} checked={s.pdfixstars} onToggle={() => onPatch(withZodiacalMode({ pdfixstars: !s.pdfixstars }))} />
          <GlyphCheck glyph={PLANET_GLYPHS[SE_CHIRON]} label={t("primdir.chiron")} checked={s.pdpromchiron} onToggle={() => onPatch({ pdpromchiron: !s.pdpromchiron })} />
          <GlyphCheck label={t("primdir.arabicParts")} checked={s.pdpromarabicparts} onToggle={() => onPatch({ pdpromarabicparts: !s.pdpromarabicparts })} />
        </div>
        {s.pdpromarabicparts && s.arabicPartNames.length > 0 ? (
          <select
            value={s.pdpromarabicpartname}
            onChange={(e) => onPatch({ pdpromarabicpartname: e.target.value })}
            className="ml-1 mt-1 h-6 rounded border bg-background px-1 text-[length:var(--aries-font-size-small)]"
          >
            {s.arabicPartNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : null}
        {/* Fixed-Star PD selection sub-dialog (fixstarspddlg.py). Only meaningful
            when Fixed Stars are enabled as promissors and zodiacal sub-mode is on. */}
        <FixStarPdPicker
          catalog={s.pdFixStarCatalog ?? []}
          selection={s.pdfixstarssel ?? []}
          maxSelected={s.pdFixStarMaxSelected ?? 200}
          disabled={!s.pdfixstars}
          onPatch={onPatch}
        />
        <CustomerPointBlock
          title={t("primdir.keyUserP")}
          enabled={s.pdcustomer}
          lon={s.pdcustomerlon}
          lat={s.pdcustomerlat}
          southern={s.pdcustomersouthern}
          onPatch={onPatch}
          enabledKey="pdcustomer"
          lonKey="pdcustomerlon"
          latKey="pdcustomerlat"
          southernKey="pdcustomersouthern"
        />
        {/* Sec. Motion (gated on Moon promissor — onPromMoon:700) + iteration */}
        <div className="ml-1 mt-1 flex items-center gap-2">
          <GlyphCheck
            label={t("primdir.secMotion")}
            checked={s.pdsecmotion}
            onToggle={() => {
              if (s.promplanets[1]) {
                onPatch({ pdsecmotion: !s.pdsecmotion });
                return;
              }
              const promplanets = s.promplanets.slice();
              promplanets[1] = true;
              onPatch({ promplanets, pdsecmotion: true });
            }}
          />
          <select
            disabled={!s.promplanets[1] || !s.pdsecmotion}
            value={s.pdsecmotioniter}
            onChange={(e) => onPatch({ pdsecmotioniter: Number(e.target.value) })}
            className="h-6 rounded border bg-background px-1 text-[length:var(--aries-font-size-small)] disabled:opacity-40"
          >
            {SMITER_LABEL_KEYS.map((k, i) => (
              <option key={k} value={i}>
                {t(k)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Separator />

      {/* Aspects grid */}
      <div>
        <div className="flex items-center justify-between">
          <SectionLabel>{t("primdir.aspects")}</SectionLabel>
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[length:var(--aries-font-size-section)]" onClick={() => aspSelectAll(false)}>
              {t("primdir.deselectAll")}
            </Button>
            <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[length:var(--aries-font-size-section)]" onClick={() => aspSelectAll(true)}>
              {t("primdir.selectAll")}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-2">
          {PD_ASPECTS.map((a, i) => (
            <GlyphCheck
              key={a.name}
              glyph={a.glyph}
              label={t(PD_ASPECT_LABEL_KEYS[i])}
              checked={!!s.pdaspects[i]}
              onToggle={() => toggleVec("pdaspects", i)}
            />
          ))}
          {/* pdparallels[0]=Parallel, [1]=RaptParallel (rapt only Placidian) */}
          <GlyphCheck glyph={PD_PARALLELS[0].glyph} label={t("primdir.parallelParallel")} checked={!!s.pdparallels[0]} onToggle={() => toggleVec("pdparallels", 0)} />
          <GlyphCheck textGlyph="∥" label={t("primdir.parallelRapt")} checked={!!s.pdparallels[1]} disabled={!raptEnabled} onToggle={() => toggleVec("pdparallels", 1)} />
        </div>
      </div>

      <Separator />

      {/* Significators grid */}
      <div>
        <div className="flex items-center justify-between">
          <SectionLabel>{t("primdir.significators")}</SectionLabel>
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[length:var(--aries-font-size-section)]" onClick={() => sigSelectAll(false)}>
              {t("primdir.deselectAll")}
            </Button>
            <Button size="xs" variant="ghost" className="h-5 px-1.5 text-[length:var(--aries-font-size-section)]" onClick={() => sigSelectAll(true)}>
              {t("primdir.selectAll")}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-2">
          {PD_ANGLE_NAMES.map((name, i) => (
            <GlyphCheck key={name} label={t(PD_ANGLE_LABEL_KEYS[i])} checked={!!s.sigangles[i]} onToggle={() => toggleVec("sigangles", i)} />
          ))}
          <GlyphCheck label={t("primdir.houseCusps")} checked={s.sighouses} onToggle={() => onPatch({ sighouses: !s.sighouses })} />
          {PD_PLANET_NAMES.map((name, i) => (
            <GlyphCheck
              key={`sig-${name}`}
              glyph={planetGlyphs[i] ?? PD_PLANET_GLYPHS[i]}
              label={t(PD_PLANET_LABEL_KEYS[i])}
              checked={!!s.sigplanets[i]}
              onToggle={() => toggleVec("sigplanets", i)}
            />
          ))}
          <GlyphCheck glyph={FORTUNE_GLYPH} label={t("primdir.fortunaLof")} checked={s.siglof} onToggle={() => onPatch(withZodiacalMode({ siglof: !s.siglof }))} />
          <GlyphCheck label={t("primdir.syzygy")} checked={s.pdsyzygy} onToggle={() => onPatch(withZodiacalMode({ pdsyzygy: !s.pdsyzygy }))} />
          <GlyphCheck glyph={PLANET_GLYPHS[SE_CHIRON]} label={t("primdir.chiron")} checked={s.pdsigchiron} onToggle={() => onPatch({ pdsigchiron: !s.pdsigchiron })} />
          <GlyphCheck glyph={VERTEX_GLYPH} label={t("primdir.vertex")} checked={s.pdsigvertex} onToggle={() => onPatch({ pdsigvertex: !s.pdsigvertex })} />
          <GlyphCheck label={t("primdir.arabicParts")} checked={s.pdsigarabicparts} onToggle={() => onPatch({ pdsigarabicparts: !s.pdsigarabicparts })} />
        </div>
        <CustomerPointBlock
          title={t("primdir.keyUserS")}
          enabled={s.pdcustomer2}
          lon={s.pdcustomer2lon}
          lat={s.pdcustomer2lat}
          southern={s.pdcustomer2southern}
          onPatch={onPatch}
          enabledKey="pdcustomer2"
          lonKey="pdcustomer2lon"
          latKey="pdcustomer2lat"
          southernKey="pdcustomer2southern"
        />
        {/* Arabic-part significator picker (primarydirsdlg.py:828 SingleChoice) */}
        {s.pdsigarabicparts && s.arabicPartNames.length > 0 ? (
          <select
            value={s.pdsigarabicpartname}
            onChange={(e) => onPatch({ pdsigarabicpartname: e.target.value })}
            className="ml-1 mt-1 h-6 rounded border bg-background px-1 text-[length:var(--aries-font-size-small)]"
          >
            {s.arabicPartNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <Separator />

      {/* Circumambulation method */}
      <div>
        <SectionLabel>{t("primdir.circumambulationMethod")}</SectionLabel>
        <RadioRow
          options={[
            { value: 0, label: t("primdir.ascensionalTimes") },
            { value: 1, label: t("primdir.usePdSettings") },
          ] as const}
          value={s.pdcircumoa}
          onChange={(v) => onPatch({ pdcircumoa: v })}
        />
      </div>

      <Separator />

      {/* PDs in Chart — pdsinchartdlgopts + pdsinchartterrdlgopts. */}
      <div>
        <SectionLabel>{t("primdir.pdsInChart")}</SectionLabel>
        <div className="mt-1 text-[length:var(--aries-font-size-section)] font-medium text-muted-foreground">
          {t("primdir.celestialChartProjection")}
        </div>
        <RadioRow
          options={[
            { value: 0, label: t("primdir.fromMundanePositions") },
            { value: 1, label: t("primdir.fromZodiacalPositions") },
            { value: 2, label: t("primdir.pseudoAstronomical") },
          ] as const}
          value={s.pdincharttyp}
          onChange={(v) => onPatch({ pdincharttyp: v })}
        />
        <div className="ml-4">
          <PlainCheck
            label={t("primdir.secMotion")}
            checked={s.pdinchartsecmotion}
            onToggle={() => onPatch({
              pdincharttyp: 2,
              pdinchartsecmotion: s.pdincharttyp === 2 ? !s.pdinchartsecmotion : true,
            })}
          />
        </div>
        <p className="mt-1 text-[length:var(--aries-font-size-small)] leading-snug text-muted-foreground">
          {t("primdir.celestialProjectionExplanation")}
        </p>
        <label className="mt-2 block">
          <span className="text-[length:var(--aries-font-size-section)] font-medium text-muted-foreground">
            {t("primdir.celestialRingRoles")}
          </span>
          <select
            value={s.pdinchartreverse ? "outer-promissor" : "outer-significator"}
            onChange={(e) => onPatch({ pdinchartreverse: e.target.value === "outer-promissor" })}
            className="mt-1 h-6 w-full rounded border bg-background px-1 text-[length:var(--aries-font-size-small)]"
          >
            <option value="outer-promissor">{t("primdir.outerPromissorRadixSignificator")}</option>
            <option value="outer-significator">{t("primdir.outerSignificatorRadixPromissorMorinus")}</option>
          </select>
        </label>
        <div className="mt-2 text-[length:var(--aries-font-size-section)] font-medium text-muted-foreground">
          {t("primdir.terrestrialChartProjection")}
        </div>
        <PlainCheck
          label={t("primdir.secMotion")}
          checked={s.pdinchartterrsecmotion}
          onToggle={() => onPatch({ pdinchartterrsecmotion: !s.pdinchartterrsecmotion })}
        />
        <p className="mt-1 text-[length:var(--aries-font-size-small)] leading-snug text-muted-foreground">
          {t("primdir.terrestrialSecondaryMotionExplanation")}
        </p>
      </div>

      <Separator />

      {/* Revolutions */}
      <div>
        <SectionLabel>{t("primdir.revolutions")}</SectionLabel>
        <RadioRow
          options={[
            { value: 0, label: t("primdir.solarSr365") },
            { value: 1, label: t("primdir.solarSr360") },
          ] as const}
          value={s.pdrevsunyearmode}
          onChange={(v) => onPatch({ pdrevsunyearmode: v })}
        />
        <div className="mt-1 text-[length:var(--aries-font-size-section)] font-medium text-muted-foreground">{t("primdir.annualDirectionsSr")}</div>
        <RadioRow
          options={[
            { value: 0, label: t("primdir.usePrimarySettings") },
            { value: 1, label: t("primdir.traditionalAnnualDirections") },
          ] as const}
          value={s.pdrevannualmode}
          onChange={(v) => onPatch({ pdrevannualmode: v })}
        />
        <PlainCheck
          label={t("primdir.natalRadixProms")}
          checked={s.pdrevshownatalpromissors}
          onToggle={() => onPatch({ pdrevshownatalpromissors: !s.pdrevshownatalpromissors })}
        />
      </div>

      {/* List View */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[length:var(--aries-font-size-small)] font-medium text-muted-foreground">{t("primdir.listView")}</span>
          <select
            value={s.pdlistmode}
            onChange={(e) => onPatch({ pdlistmode: Number(e.target.value) })}
            className="h-6 rounded border bg-background px-1 text-[length:var(--aries-font-size-small)]"
          >
            <option value={0}>{t("primdir.paged")}</option>
            <option value={1}>{t("primdir.continuous")}</option>
          </select>
        </div>
        <PlainCheck
          label={t("primdir.coloredGlyphRows")}
          checked={s.pdlistglyphcolors}
          onToggle={() => onPatch({ pdlistglyphcolors: !s.pdlistglyphcolors })}
        />
      </div>
    </div>
  );
}

function KeysBlock({
  settings: s,
  onPatch,
}: {
  settings: OptionsPrimaryDirections;
  onPatch: (patch: Patch) => void;
}) {
  const t = useT();
  const dynamic = s.pdkeydyn;
  const presetKeys = dynamic ? KEY_DYN_LABEL_KEYS : KEY_STAT_LABEL_KEYS;
  const presetSel = dynamic ? s.pdkeyd : s.pdkeys;
  const isCustomer = !dynamic && s.pdkeys === KEY_CUSTOMER_IDX;

  return (
    <div>
      <SectionLabel>{t("primdir.keys")}</SectionLabel>
      <RadioRow
        options={[
          { value: 0, label: t("primdir.dynamic") },
          { value: 1, label: t("primdir.static") },
        ] as const}
        value={dynamic ? 0 : 1}
        onChange={(v) => onPatch({ pdkeydyn: v === 0 })}
      />
      <select
        value={presetSel}
        onChange={(e) =>
          onPatch(dynamic ? { pdkeyd: Number(e.target.value) } : { pdkeys: Number(e.target.value) })
        }
        className="mt-1 h-6 w-full rounded border bg-background px-1 text-[length:var(--aries-font-size-small)]"
      >
        {presetKeys.map((k, i) => (
          <option key={k} value={i}>
            {t(k)}
          </option>
        ))}
      </select>
      <div className="mt-1 grid grid-cols-4 gap-2">
        <KeyField key={`deg-${s.pdkeydeg}`} label={t("primdir.deg")} value={s.pdkeydeg} disabled={!isCustomer} max={9} onCommit={(v) => onPatch({ pdkeydeg: v })} />
        <KeyField key={`min-${s.pdkeymin}`} label={t("primdir.min")} value={s.pdkeymin} disabled={!isCustomer} max={59} onCommit={(v) => onPatch({ pdkeymin: v })} />
        <KeyField key={`sec-${s.pdkeysec}`} label={t("primdir.sec")} value={s.pdkeysec} disabled={!isCustomer} max={59} onCommit={(v) => onPatch({ pdkeysec: v })} />
        <div className="flex flex-col">
          <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{t("primdir.coefficient")}</span>
          <Input readOnly value={s.pdkeycoeff.toFixed(8)} className="h-6 text-[length:var(--aries-font-size-small)]" />
        </div>
      </div>
      <div className="mt-2">
        <PlainCheck label={t("primdir.useRegressiveSun")} checked={s.useregressive} onToggle={() => onPatch({ useregressive: !s.useregressive })} />
      </div>
    </div>
  );
}

function KeyField({
  label,
  value,
  disabled,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  max: number;
  onCommit: (v: number) => void;
}) {
  // Seeded from the daemon value; the caller remounts via key={value} so an
  // external commit resets the draft without a setState-in-effect.
  const [draft, setDraft] = React.useState(String(value));
  return (
    <div className="flex flex-col">
      <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{label}</span>
      <Input
        inputMode="numeric"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          // Clamp 0..max then commit (intvalidator.IntValidator, primarydirsdlg
          // .py:467). The daemon re-runs the calc on commit.
          const n = Math.max(0, Math.min(max, Number(draft || 0)));
          if (n !== value) onCommit(n);
          setDraft(String(n));
        }}
        className="h-6 text-[length:var(--aries-font-size-small)]"
      />
    </div>
  );
}
