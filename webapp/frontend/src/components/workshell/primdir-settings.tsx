// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { Check, ChevronDown, CopyPlus, RotateCcw, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ASPECT_GLYPHS,
  FORTUNE_GLYPH,
  PLANET_GLYPHS,
  PLANET_GLYPH_SEQUENCE,
  SE_CHIRON,
  SE_MEAN_APOG,
  VERTEX_GLYPH,
} from "@/lib/chart/glyphs";
import type { OptionsPatch, OptionsPrimaryDirections, PrimaryDirectionPresetCommand } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import type { PrimaryDirectionsSettingsTab, SettingsSearchTarget } from "@/lib/settings-search";
import { PD_SYSTEM_LABEL_KEYS } from "@/lib/settings-search-fields";
import { cn } from "@/lib/utils";
import { ListSegmentedControl } from "./list-controls";

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

// Index order follows primdirs.py PrimDirs static (NAIBOD..CUSTOMER) and
// dynamic (TRUESOLAREQUATORIALARC..BIRTHDAYSOLARECLIPTICALARC) keys.
const KEY_STAT_LABEL_KEYS = [
  "primdir.keyNaibod",
  "primdir.keyCardan",
  "primdir.keyPtolemy",
  "primdir.keyCustom",
] as const;
const KEY_DYN_LABEL_KEYS = [
  "primdir.keyTrueSolarArcEquatorial",
  "primdir.keyBirthSunMotionEquatorial",
  "primdir.keyTrueSolarArcEcliptical",
  "primdir.keyBirthSunMotionEcliptical",
] as const;
const KEY_CUSTOMER_IDX = 3; // primdirs.py:130 PrimDirs.CUSTOMER

// Display-label i18n keys for the radio/grid constants defined above. The
// English/values live in the constants; these carry the translated captions.
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
};

/** The chart settings the PD engine directs: the node and the Moon parallax
 * correction. Every shipped preset overrides both (mean node, parallax off). */
export type PrimaryDirectionGlobals = { meannode: boolean; topocentric: boolean };

// Shipped presets use the mean node (Marr, Estadella) and the geocentric
// Moon (Polich/Page; Morin's worked examples, although AG16 ch. 5 states the
// parallax rule).
const PRESET_GLOBALS: PrimaryDirectionGlobals = { meannode: true, topocentric: false };

function globalsPatch(globals: Partial<PrimaryDirectionGlobals>): OptionsPatch {
  return {
    ...(globals.meannode == null ? {} : { planetsPoints: { meannode: globals.meannode } }),
    ...(globals.topocentric == null ? {} : { display: { topocentric: globals.topocentric } }),
  };
}

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
  pdpromapogee: true,
  pdpromarabicparts: false,
  pdpromasteroids: false,
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
  pdsigapogee: true,
  pdsigvertex: false,
  pdsigarabicparts: false,
  pdsigasteroids: false,
  pdcustomer2: false,
  pdcustomer2southern: false,
  pdcircumoa: 1,
  pdcircumprommode: 0,
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
    // Presets without a star selection leave the current chooser intact.
    ...(patch.pdfixstarssel !== undefined ? { pdfixstarssel: patch.pdfixstarssel.slice() } : {}),
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
      // Morin's converse: the significator carried to the promissor, under
      // the promissor's pole (AG 22 ch. 7; his own nativity, AG 23).
      pdconverse: 1,
      zodpromsigasps: [true, false],
      ascmchcsasproms: false,
      promplanets: CORE_7,
      pdantiscia: true,
      pdmorinpromittorset: true,
      pdmidpoints: false,
      pdterms: false,
      pdpromchiron: false,
      pdpromapogee: false,
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
      pdsigapogee: false,
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
      // Marr and Estadella keep the significator's own pole: modern converse.
      pdconverse: 0,
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
      pdpromapogee: false,
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
      pdsigapogee: false,
      pdsigvertex: false,
      pdsigarabicparts: false,
      pdcustomer: false,
      pdcustomer2: false,
    }),
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
      pdpromapogee: false,
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
      pdsigapogee: false,
      pdsigvertex: false,
      pdkeys: 2,
      // Ptolemy's prorogation in the order of the leading signs: the
      // prorogator "moves toward them" by the primary motion, the
      // traditional converse (Tetrabiblos III.10).
      pdconverse: 1,
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

function presetMatchesSettings(
  settings: OptionsPrimaryDirections,
  preset: PrimaryDirectionPreset,
  globals?: PrimaryDirectionGlobals,
): boolean {
  if (globals && (globals.meannode !== PRESET_GLOBALS.meannode
      || globals.topocentric !== PRESET_GLOBALS.topocentric)) return false;
  const patch = presetResolvedPatch(preset, settings);
  return Object.entries(patch).every(([key, expected]) => {
    if (expected === undefined) return true;
    return patchValueEquals(settings[key as keyof OptionsPrimaryDirections], expected);
  });
}

function activePrimaryDirectionPreset(
  settings: OptionsPrimaryDirections,
  globals?: PrimaryDirectionGlobals,
): PrimaryDirectionPreset | null {
  return PRIMARY_DIRECTION_PRESETS.find((preset) => presetMatchesSettings(settings, preset, globals)) ?? null;
}

function presetResolvedPatch(preset: PrimaryDirectionPreset, settings: OptionsPrimaryDirections): Patch {
  return {
    ...preset.patch,
    ...(preset.buildPatch?.(settings) ?? {}),
  };
}

function GlyphCheck({
  glyph,
  textGlyph,
  label,
  hint,
  checked,
  disabled,
  className,
  onToggle,
}: {
  glyph?: string;
  textGlyph?: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={hint ?? label}
      disabled={disabled}
      aria-pressed={checked}
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
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border text-[length:var(--aries-font-size-section)]",
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
  hint,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <GlyphCheck label={label} hint={hint} checked={checked} disabled={disabled} onToggle={onToggle} />
  );
}

function RadioRow<T extends string | number>({
  options,
  value,
  disabled,
  disabledValues,
  wrapLabels = false,
  onChange,
}: {
  options: readonly { value: T; label: string; searchAnchor?: string }[];
  value: T;
  disabled?: boolean;
  disabledValues?: readonly T[];
  wrapLabels?: boolean;
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
            data-settings-search-anchor={o.searchAnchor}
            disabled={optionDisabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs",
              "hover:bg-accent disabled:opacity-40 disabled:pointer-events-none",
            )}
          >
            <span aria-hidden className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
              <span
                className={cn(
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border",
                  value === o.value ? "border-primary" : "border-border",
                )}
              >
                {value === o.value ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                ) : null}
              </span>
            </span>
            <span className={wrapLabels ? "whitespace-normal" : "truncate"}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SectionLabel({ children, searchAnchor }: { children: React.ReactNode; searchAnchor?: string }) {
  return (
    <div data-settings-search-anchor={searchAnchor} className="mt-1 text-[length:var(--aries-font-size-small)] font-semibold text-muted-foreground">
      {children}
    </div>
  );
}

function SmallNumberInput({
  value,
  min,
  max,
  label,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  label?: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <Input
      key={value}
      type="number"
      aria-label={label}
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
    <div className="mt-1">
      <PlainCheck
        label={title}
        checked={enabled}
        onToggle={() => onPatch({ [enabledKey]: !enabled } as Patch)}
      />
      <div hidden={!enabled} className="ml-1 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
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
      <div hidden={!enabled} className="ml-1">
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

function SelectionActions({ onReset, onSelectAll, onClear }: {
  onReset: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button type="button" size="icon-xs" variant="ghost" onClick={onReset}
        title={t("primdir.resetSelection")} aria-label={t("primdir.resetSelection")}>
        <RotateCcw className="size-3.5" aria-hidden />
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={onClear}>
        {t("primdir.deselectAll")}
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={onSelectAll}>
        {t("primdir.selectAll")}
      </Button>
    </div>
  );
}

// Retained, inline React drawer: the family switch and its chooser are one
// control. Selection remains canonical option state when collapsed or off.
function PointFamilyPicker({ label, enabled, items, selectedIds, maxSelected,
  onEnabledChange, onSelectionChange, onReset }: {
  label: string;
  enabled: boolean;
  items: { id: string; label: string; code?: string }[];
  selectedIds: string[];
  maxSelected?: number;
  onEnabledChange: (enabled: boolean) => void;
  onSelectionChange: (ids: string[]) => void;
  onReset: () => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const drawerId = React.useId();
  const selected = new Set(selectedIds);
  const visible = items.filter(item => `${item.label} ${item.code ?? ""}`.toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase()));
  const choose = (ids: string[]) => onSelectionChange(maxSelected ? ids.slice(0, maxSelected) : ids);
  return (
    <div className="col-span-2 min-w-0">
      <div className="flex items-center gap-1">
        <GlyphCheck label={label} checked={enabled} onToggle={() => {
          onEnabledChange(!enabled);
          setOpen(!enabled);
        }} />
        <Button type="button" size="xs" variant="ghost" aria-expanded={open}
          aria-controls={drawerId} title={label} onClick={() => setOpen(value => !value)}
          className="gap-1 text-muted-foreground">
          <span>{t("primdir.selectedCount", { count: selectedIds.length })}</span>
          <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      <div id={drawerId} hidden={!open} className="space-y-1 border-y border-border/70 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <Input value={query} onChange={event => setQuery(event.target.value)}
            placeholder={t("primdir.placeholderName")} aria-label={t("primdir.placeholderName")}
            className="h-6 min-w-0 flex-1 text-[length:var(--aries-font-size-small)]" />
          <SelectionActions onReset={onReset} onClear={() => choose([])}
            onSelectAll={() => choose(items.map(item => item.id))} />
        </div>
        <ScrollArea className="max-h-40 [&>[data-slot=scroll-area-viewport]]:max-h-40">
          <div className="flex flex-wrap items-center gap-1.5">
            {visible.map(item => (
              <Button key={item.id} type="button" size="xs"
                variant={selected.has(item.id) ? "default" : "outline"}
                aria-pressed={selected.has(item.id)} title={item.code ? `${item.label} (${item.code})` : item.label}
                disabled={!selected.has(item.id) && maxSelected !== undefined && selectedIds.length >= maxSelected}
                onClick={() => choose(selected.has(item.id)
                  ? selectedIds.filter(id => id !== item.id) : [...selectedIds, item.id])}
                className="h-auto min-h-6 whitespace-normal px-2 text-left text-[length:var(--aries-font-size-small)]">
                {item.label}
              </Button>
            ))}
            {!visible.length && <span className="text-xs text-muted-foreground">{t("astrocart.config.noMatchingPoints")}</span>}
          </div>
        </ScrollArea>
        {maxSelected !== undefined && <p className="text-[length:var(--aries-font-size-section)] text-muted-foreground">
          {t("primdir.starsLeft", { count: Math.max(0, maxSelected - selectedIds.length) })}
        </p>}
      </div>
    </div>
  );
}

function EngineSelection({
  settings,
  globals,
  dock,
  onPatch,
  onPresetChange,
}: {
  settings: OptionsPrimaryDirections;
  globals?: PrimaryDirectionGlobals;
  onPresetChange: (settings: OptionsPrimaryDirections) => void;
  dock: "right" | "bottom";
  onPatch: (patch: Patch, optionsPatch?: OptionsPatch) => void | Promise<boolean>;
}) {
  const t = useT();
  const activePreset = activePrimaryDirectionPreset(settings, globals);
  const userPresets = settings.userPresets;
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const perform = async (command: Omit<PrimaryDirectionPresetCommand, "baseRevision">, patch: Patch = {}, globalPatch?: OptionsPatch) => {
    if (!userPresets || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const ok = await onPatch(patch, { ...globalPatch, primaryDirectionPreset: { ...command, baseRevision: userPresets.revision } });
      if (ok === false) { setFailed(true); return; }
      setNaming(false);
      setName("");
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };
  const startNaming = () => { setNaming(true); setName(""); setFailed(false); };
  const save = () => {
    if (naming) {
      if (name.trim()) void perform({ action: "save", name: name.trim() });
    } else if (userPresets?.selectedId) {
      void perform({ action: "save", id: userPresets.selectedId });
    } else startNaming();
  };


  return (
    <div className={cn("min-w-0", dock === "bottom" && "col-span-2")}>
      <div className={cn("grid gap-[var(--aries-pane-content-padding)]", dock === "bottom" ? "grid-cols-2" : "grid-cols-1")}>
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            <SectionLabel searchAnchor="primdir.enginePreset">{t("primdir.enginePreset")}</SectionLabel>
            {activePreset == null ? (
              <span className="text-[length:var(--aries-font-size-section)] text-muted-foreground">{t("primdir.custom")}</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            {PRIMARY_DIRECTION_PRESETS.map((preset) => {
              const selected = preset.id === activePreset?.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={t(PRESET_DESC_KEYS[preset.id] ?? preset.description)}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => {
                    const patch = presetResolvedPatch(preset, settings);
                    onPresetChange({ ...settings, ...patch });
                    // A shipped preset sets the chart's node and Moon parallax
                    // correction, which the PD engine directs.
                    const chartPatch = globalsPatch(PRESET_GLOBALS);
                    if (userPresets?.selectedId) void perform({ action: "clear" }, patch, chartPatch);
                    else onPatch(patch, chartPatch);
                  }}
                  className={cn(
                    "flex min-h-7 w-full items-center gap-2 rounded px-2 py-1 text-left text-[length:var(--aries-font-size-small)] hover:bg-muted/50",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  </span>
                  <span className="font-medium">{t(PRESET_LABEL_KEYS[preset.id] ?? preset.label)}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-1">
            {naming ? (
              <Input autoFocus maxLength={80} value={name} disabled={busy}
                className="h-7 min-w-0 flex-1 text-[length:var(--aries-font-size-small)]"
                placeholder={t("pdPreset.name")} aria-label={t("pdPreset.name")}
                onChange={event => setName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") { event.preventDefault(); save(); }
                  if (event.key === "Escape") { event.preventDefault(); setNaming(false); }
                }} />
            ) : (
              <select data-aries-surface="control" aria-label={t("pdPreset.title")}
                className="h-7 min-w-0 flex-1 rounded border border-[color:var(--aries-control-outline)] bg-transparent px-2 text-[length:var(--aries-font-size-small)] [--aries-material-state-background:transparent]"
                value={userPresets?.selectedId ?? ""} disabled={busy || !userPresets}
                onChange={event => void perform(event.target.value ? { action: "select", id: event.target.value } : { action: "clear" })}>
                <option value="">{t("pdPreset.title")}</option>
                {userPresets?.presets.map(preset => <option key={preset.id} value={preset.id}>
                  {preset.name}{preset.id === userPresets.selectedId && userPresets.dirty ? " *" : ""}
                </option>)}
              </select>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1">
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2"
              disabled={busy || !userPresets || (naming && !name.trim())} onClick={save}>
              <Save className="h-3.5 w-3.5" aria-hidden="true" />{t("settings.save")}
            </Button>
            {naming ? (
              <Button type="button" size="icon-xs" variant="ghost" disabled={busy}
                title={t("settings.cancel")} aria-label={t("settings.cancel")} onClick={() => setNaming(false)}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : <>
              <Button type="button" size="icon-xs" variant="ghost" disabled={busy || !userPresets}
                title={t("pdPreset.saveAs")} aria-label={t("pdPreset.saveAs")} onClick={startNaming}>
                <CopyPlus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={busy || !userPresets?.selectedId}
                title={t("pdPreset.delete")} aria-label={t("pdPreset.delete")}
                onClick={() => { if (userPresets?.selectedId) void perform({ action: "delete", id: userPresets.selectedId }); }}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </>}
          </div>
          {failed && <p role="alert" className="mt-1 text-[length:var(--aries-font-size-small)] text-destructive">{t("pdPreset.error")}</p>}
        </div>
        <div className="min-w-0">
          <SectionLabel searchAnchor="primdir.houseSystem">{t("primdir.houseSystem")}</SectionLabel>
          <RadioRow
            options={PD_SYSTEMS.map(({ value }, i) => ({
              value, label: t(PD_SYSTEM_LABEL_KEYS[i]), searchAnchor: PD_SYSTEM_LABEL_KEYS[i],
            }))}
            value={settings.primarydir}
            wrapLabels
            onChange={(v) =>
              onPatch(v === 1 ? { primarydir: v, subprimarydir: 1 } : { primarydir: v })
            }
          />
        </div>
      </div>
    </div>
  );
}

export function PrimDirSettingsBody({
  settings: s,
  globals,
  planetGlyphs,
  dock = "right",
  paneDock,
  onPaneDockChange,
  searchTarget,
  onPatch,
}: {
  settings: OptionsPrimaryDirections;
  /** The chart's node and Moon parallax correction, shown and set here too. */
  globals?: PrimaryDirectionGlobals;
  planetGlyphs: readonly string[];
  dock?: "right" | "bottom";
  paneDock?: "right" | "bottom";
  onPaneDockChange?: (dock: "right" | "bottom") => void;
  searchTarget?: SettingsSearchTarget | null;
  onPatch: (patch: Patch, optionsPatch?: OptionsPatch) => void | Promise<boolean>;
}) {
  const t = useT();
  const [activeTab, setActiveTab] = React.useState<PrimaryDirectionsSettingsTab>(
    () => searchTarget?.directionsTab ?? "calculation",
  );
  const [lastSearchTarget, setLastSearchTarget] = React.useState(searchTarget);
  if (lastSearchTarget !== searchTarget) {
    setLastSearchTarget(searchTarget);
    if (searchTarget?.directionsTab) setActiveTab(searchTarget.directionsTab);
  }
  const [baseline, setBaseline] = React.useState(() => ({ settings: s, presetId: s.userPresets?.selectedId }));
  if (s.userPresets?.selectedId !== baseline.presetId && !s.userPresets?.dirty) {
    setBaseline({ settings: s, presetId: s.userPresets?.selectedId });
  }
  const initial = s.userPresets?.resetSettings
    ? { ...baseline.settings, ...s.userPresets.resetSettings } : baseline.settings;
  const resetFields = (keys: (keyof OptionsPrimaryDirections)[]) => {
    const patch = Object.fromEntries(keys.map(key => [key, initial[key]])) as Patch;
    onPatch(patch);
  };
  const partItems = s.arabicPartNames.map(name => ({ id: name, label: name }));
  const asteroidItems = (s.pdAsteroidCatalog ?? []).map(item => ({ id: String(item.number), label: item.name }));
  const starItems = s.pdFixStarCatalog.map(item => ({ id: item.code, label: item.name, code: item.code }));
  const starIds = (selection: boolean[]) => s.pdFixStarCatalog.filter(item => selection[item.ordinal]).map(item => item.code);
  const starPatch = (ids: string[]): Patch => ({ pdfixstarssel: s.pdFixStarCatalog.map(item => ids.includes(item.code)) });
  const partSelection = (settings: OptionsPrimaryDirections, role: "prom" | "sig") =>
    settings[`pd${role}arabicpartnames`] ?? (settings[`pd${role}arabicpartname`] ? [settings[`pd${role}arabicpartname`]] : []);
  const isPlacidianSemiarc = s.primarydir === 0;
  const zodiacalActive = s.subprimarydir === 1 || s.subprimarydir === 2; // Zodiacal|Both
  const bottomWideSectionClass = dock === "bottom" ? "col-span-2" : undefined;
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
      pdpromchiron: val,
      pdpromapogee: val,
      pdpromasteroids: val,
      ...(val ? { pdpromarabicpartnames: s.arabicPartNames,
        pdpromasteroidnumbers: (s.pdAsteroidCatalog ?? []).map(item => item.number),
        pdfixstarssel: s.pdFixStarCatalog.map((_, index) => index < s.pdFixStarMaxSelected) } : {}),
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
      pdsigapogee: val,
      pdsigarabicparts: val,
      pdsigasteroids: val,
      ...(val ? { pdsigarabicpartnames: s.arabicPartNames,
        pdsigasteroidnumbers: (s.pdAsteroidCatalog ?? []).map(item => item.number) } : {}),
    });
  };

  const contentClassName = cn(
    "min-h-0 w-full flex-1 gap-[var(--aries-pane-content-padding)] overflow-auto px-[var(--aries-pane-header-compact-padding-x)] pb-[var(--aries-pane-title-gap)]",
    dock === "bottom"
      ? "grid grid-cols-2 items-start [&>[data-slot=separator]]:hidden"
      : "flex flex-col",
  );

  return (
    <Tabs value={activeTab} onValueChange={value => {
      if (value === "calculation" || value === "chart" || value === "list") setActiveTab(value);
    }} className="min-h-0 w-full flex-1 overflow-hidden">
      <div className="shrink-0 space-y-2 px-[var(--aries-pane-header-compact-padding-x)]">
        {paneDock && onPaneDockChange ? (
          <div>
            <SectionLabel>{t("primdir.settingsTitle")}</SectionLabel>
            <RadioRow
              options={[
                { value: "right", label: t("search.filtersPaneRight") },
                { value: "bottom", label: t("search.filtersPaneBottom") },
              ] as const}
              value={paneDock}
              onChange={onPaneDockChange}
            />
          </div>
        ) : null}

        <TabsList variant="line" className="w-full" aria-label={t("primdir.settingsTitle")}>
          <TabsTrigger value="calculation" data-settings-search-anchor="pd-tab:calculation" className="text-[length:var(--aries-font-size-small)] after:hidden">{t("primdir.calculationTab")}</TabsTrigger>
          <TabsTrigger value="chart" data-settings-search-anchor="pd-tab:chart" className="text-[length:var(--aries-font-size-small)] after:hidden">{t("primdir.chartTab")}</TabsTrigger>
          <TabsTrigger value="list" data-settings-search-anchor="pd-tab:list" className="text-[length:var(--aries-font-size-small)] after:hidden">{t("primdir.listTab")}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="calculation" keepMounted className="flex min-h-0 flex-col data-[hidden]:hidden">
        <div className={contentClassName}>
          <EngineSelection settings={s} globals={globals} dock={dock} onPatch={onPatch}
            onPresetChange={settings => setBaseline({ settings, presetId: s.userPresets?.selectedId })} />

          {/* Keys, beside the chart's own positions the engine directs. */}
          <div className={cn(!globals && bottomWideSectionClass)}>
            <KeysBlock settings={s} onPatch={onPatch} />
          </div>

          {/* The chart's own node and Moon parallax correction (the menu's
              settings), which the PD engine directs (recalc). */}
          {globals ? (
            <div>
              <SectionLabel searchAnchor="primdir.chartPositions">{t("primdir.chartPositions")}</SectionLabel>
              <RadioRow
                options={[
                  { value: 1, label: t("primdir.meanNode") },
                  { value: 0, label: t("primdir.trueNode") },
                ] as const}
                value={globals.meannode ? 1 : 0}
                onChange={(v) => onPatch({}, globalsPatch({ meannode: v === 1 }))}
              />
              <PlainCheck
                label={t("primdir.parallaxCorrection")}
                checked={globals.topocentric}
                onToggle={() => onPatch({}, globalsPatch({ topocentric: !globals.topocentric }))}
              />
            </div>
          ) : null}

          <Separator />

          {/* Mundane / Zodiacal / Both */}
          <div>
            <SectionLabel searchAnchor="primdir.sectionMode">{t("primdir.sectionMode")}</SectionLabel>
            <RadioRow
              options={PD_SUBMODES.map((o, i) => ({ value: o.value, label: t(PD_SUBMODE_LABEL_KEYS[i]) }))}
              value={s.subprimarydir}
              onChange={(v) => onPatch({ subprimarydir: v })}
            />
          </div>

          {/* Which converse is calculated; changes the converse arcs (recalc). */}
          <div>
            <SectionLabel searchAnchor="primdir.converseCalculation">{t("primdir.converseCalculation")}</SectionLabel>
            <RadioRow
              options={[
                { value: 0, label: t("primdir.converseModern") },
                { value: 1, label: t("primdir.converseTraditional") },
              ] as const}
              value={s.pdconverse}
              wrapLabels
              onChange={(v) => onPatch({ pdconverse: v })}
            />
            {/* The regressive Sun: modern converse rows timed by the Sun's
                motion before birth. Only a true solar arc key follows the
                real Sun; traditional converse rows perfect after birth. */}
            <div className="ml-4 mt-0.5 flex flex-col">
              <PlainCheck
                label={t("primdir.prenatalSun")}
                hint={t("primdir.prenatalSunHint")}
                checked={s.useregressive}
                disabled={!prenatalSunApplies(s)}
                onToggle={() => onPatch({ useregressive: !s.useregressive })}
              />
            </div>
          </div>

          {/* Use Latitude of */}
          <div>
            <SectionLabel searchAnchor="primdir.useLatitudeOf">{t("primdir.useLatitudeOf")}</SectionLabel>
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
            <SectionLabel searchAnchor="primdir.zodiacalOptions">{t("primdir.zodiacalOptions")}</SectionLabel>
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
          <div className={bottomWideSectionClass}>
            <div className="flex items-center justify-between">
              <SectionLabel searchAnchor="primdir.promissors">{t("primdir.promissors")}</SectionLabel>
              <SelectionActions onReset={() => resetFields(['promplanets', 'pdantiscia', 'pdmorinpromittorset', 'pdmidpoints', 'promlof', 'pdterms', 'pdfixstars', 'pdfixstarssel', 'pdpromchiron', 'pdpromapogee', 'pdpromarabicparts', 'pdpromarabicpartnames', 'pdpromarabicpartname', 'pdpromasteroids', 'pdpromasteroidnumbers', 'pdcustomer', 'pdsecmotion'])}
                onClear={() => promSelectAll(false)} onSelectAll={() => promSelectAll(true)} />
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
              <GlyphCheck glyph={PLANET_GLYPHS[SE_CHIRON]} label={t("primdir.chiron")} checked={s.pdpromchiron} onToggle={() => onPatch({ pdpromchiron: !s.pdpromchiron })} />
              <GlyphCheck glyph={PLANET_GLYPHS[SE_MEAN_APOG]} label={t("astrocart.point.apogee")} checked={s.pdpromapogee} onToggle={() => onPatch({ pdpromapogee: !s.pdpromapogee })} />
              <PointFamilyPicker label={t("primdir.arabicParts")} enabled={s.pdpromarabicparts}
                items={partItems} selectedIds={partSelection(s, "prom")}
                onEnabledChange={enabled => onPatch({ pdpromarabicparts: enabled })}
                onSelectionChange={ids => onPatch({ pdpromarabicpartnames: ids, pdpromarabicpartname: ids[0] ?? "" })}
                onReset={() => onPatch({ pdpromarabicpartnames: partSelection(initial, "prom") })} />
              <PointFamilyPicker label={t("chartmenu.asteroids")} enabled={s.pdpromasteroids}
                items={asteroidItems} selectedIds={(s.pdpromasteroidnumbers ?? []).map(String)}
                onEnabledChange={enabled => onPatch({ pdpromasteroids: enabled })}
                onSelectionChange={ids => onPatch({ pdpromasteroidnumbers: ids.map(Number) })}
                onReset={() => onPatch({ pdpromasteroidnumbers: initial.pdpromasteroidnumbers ?? [] })} />
              <PointFamilyPicker label={t("primdir.fixedStars")} enabled={s.pdfixstars}
                items={starItems} selectedIds={starIds(s.pdfixstarssel)} maxSelected={s.pdFixStarMaxSelected}
                onEnabledChange={enabled => onPatch(withZodiacalMode({ pdfixstars: enabled }))}
                onSelectionChange={ids => onPatch(starPatch(ids))}
                onReset={() => onPatch(starPatch(starIds(initial.pdfixstarssel)))} />
            </div>

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
                data-aries-control-appearance="local"
                disabled={!s.promplanets[1] || !s.pdsecmotion}
                value={s.pdsecmotioniter}
                onChange={(e) => onPatch({ pdsecmotioniter: Number(e.target.value) })}
                className="h-[var(--aries-control-height-compact)] rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-control-outline)] bg-transparent px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-small)] disabled:opacity-40"
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
          <div className={bottomWideSectionClass}>
            <div className="flex items-center justify-between">
              <SectionLabel searchAnchor="primdir.aspects">{t("primdir.aspects")}</SectionLabel>
              <SelectionActions onReset={() => resetFields(['pdaspects', 'pdparallels'])}
                onClear={() => aspSelectAll(false)} onSelectAll={() => aspSelectAll(true)} />
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
          <div className={bottomWideSectionClass}>
            <div className="flex items-center justify-between">
              <SectionLabel searchAnchor="primdir.significators">{t("primdir.significators")}</SectionLabel>
              <SelectionActions onReset={() => resetFields(['sigangles', 'sighouses', 'sigplanets', 'siglof', 'pdsyzygy', 'pdsigvertex', 'pdsigchiron', 'pdsigapogee', 'pdsigarabicparts', 'pdsigarabicpartnames', 'pdsigarabicpartname', 'pdsigasteroids', 'pdsigasteroidnumbers', 'pdcustomer2'])}
                onClear={() => sigSelectAll(false)} onSelectAll={() => sigSelectAll(true)} />
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
              <GlyphCheck glyph={PLANET_GLYPHS[SE_MEAN_APOG]} label={t("astrocart.point.apogee")} checked={s.pdsigapogee} onToggle={() => onPatch({ pdsigapogee: !s.pdsigapogee })} />
              <GlyphCheck glyph={VERTEX_GLYPH} label={t("primdir.vertex")} checked={s.pdsigvertex} onToggle={() => onPatch({ pdsigvertex: !s.pdsigvertex })} />
              <PointFamilyPicker label={t("primdir.arabicParts")} enabled={s.pdsigarabicparts}
                items={partItems} selectedIds={partSelection(s, "sig")}
                onEnabledChange={enabled => onPatch({ pdsigarabicparts: enabled })}
                onSelectionChange={ids => onPatch({ pdsigarabicpartnames: ids, pdsigarabicpartname: ids[0] ?? "" })}
                onReset={() => onPatch({ pdsigarabicpartnames: partSelection(initial, "sig") })} />
              <PointFamilyPicker label={t("chartmenu.asteroids")} enabled={s.pdsigasteroids}
                items={asteroidItems} selectedIds={(s.pdsigasteroidnumbers ?? []).map(String)}
                onEnabledChange={enabled => onPatch({ pdsigasteroids: enabled })}
                onSelectionChange={ids => onPatch({ pdsigasteroidnumbers: ids.map(Number) })}
                onReset={() => onPatch({ pdsigasteroidnumbers: initial.pdsigasteroidnumbers ?? [] })} />
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

          </div>

          <Separator />

          {/* Circumambulation method */}
          <div>
            <SectionLabel searchAnchor="primdir.circumambulationMethod">{t("primdir.circumambulationMethod")}</SectionLabel>
            <RadioRow
              options={[
                { value: 0, label: t("primdir.ascensionalTimes") },
                { value: 1, label: t("primdir.usePdSettings") },
              ] as const}
              value={s.pdcircumoa}
              onChange={(v) => onPatch({ pdcircumoa: v })}
            />
            <div className="mt-1 text-[length:var(--aries-font-size-section)] font-medium text-muted-foreground">
              {t("primdir.promissors")}
            </div>
            <RadioRow
              options={[
                { value: 0, label: t("dirview.followPd") },
                { value: 1, label: t("dirview.traditional") },
              ] as const}
              value={s.pdcircumprommode}
              onChange={(v) => onPatch({ pdcircumprommode: v })}
            />
          </div>

          <Separator />

          {/* Revolutions */}
          <div>
            <SectionLabel searchAnchor="primdir.revolutions">{t("primdir.revolutions")}</SectionLabel>
            <RadioRow
              options={[
                { value: 0, label: t("primdir.solarSr365") },
                { value: 1, label: t("primdir.solarSr360") },
              ] as const}
              value={s.pdrevsunyearmode}
              onChange={(v) => onPatch({ pdrevsunyearmode: v })}
            />
            <div className="mt-1 text-[length:var(--aries-font-size-section)] font-medium text-muted-foreground">{t("primdir.annualDirectionsSr")}</div>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="chart" keepMounted className="flex min-h-0 flex-col data-[hidden]:hidden">
        <div className={contentClassName}>
          <div>
            <SectionLabel searchAnchor="primdir.terrestrialChartProjection">{t("primdir.terrestrialChartProjection")}</SectionLabel>
            <div data-settings-search-anchor="primdir.planetarySecondaryMotion">
              <PlainCheck
                label={t("primdir.planetarySecondaryMotion")}
                checked={s.pdinchartterrsecmotion}
                onToggle={() => onPatch({ pdinchartterrsecmotion: !s.pdinchartterrsecmotion })}
              />
            </div>
            <p className="mt-1 text-[length:var(--aries-font-size-small)] leading-snug text-muted-foreground">
              {t("primdir.terrestrialSecondaryMotionExplanation")}
            </p>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="list" keepMounted className="flex min-h-0 flex-col data-[hidden]:hidden">
        <div className={contentClassName}>
          {/* List View */}
          <div className="space-y-1">
            <div className="flex items-center gap-2" data-settings-search-anchor="primdir.listView">
              <span className="text-[length:var(--aries-font-size-small)] font-medium text-muted-foreground">{t("primdir.listView")}</span>
              <select
                data-aries-control-appearance="local"
                value={s.pdlistmode}
                onChange={(e) => onPatch({ pdlistmode: Number(e.target.value) })}
                className="h-[var(--aries-control-height-compact)] rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-control-outline)] bg-transparent px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-small)]"
              >
                <option value={0}>{t("primdir.paged")}</option>
                <option value={1}>{t("primdir.continuous")}</option>
              </select>
            </div>
            <div data-settings-search-anchor="primdir.coloredGlyphRows">
              <PlainCheck
                label={t("primdir.coloredGlyphRows")}
                checked={s.pdlistglyphcolors}
                onToggle={() => onPatch({ pdlistglyphcolors: !s.pdlistglyphcolors })}
              />
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

// PrimDirs.TRUESOLAREQUATORIALARC and TRUESOLARECLIPTICALARC; the
// birthday keys are constant rates, so running them backwards changes nothing.
const TRUE_SOLAR_ARC_KEYS: readonly number[] = [0, 2];
const TRADITIONAL_CONVERSE = 1;

function prenatalSunApplies(s: OptionsPrimaryDirections): boolean {
  return s.pdconverse !== TRADITIONAL_CONVERSE && s.pdkeydyn && TRUE_SOLAR_ARC_KEYS.includes(s.pdkeyd);
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
  const isCustom = !dynamic && s.pdkeys === KEY_CUSTOMER_IDX;
  // A preset static key's rate is the reciprocal of the daemon's read-only
  // coefficient (years per degree). Dynamic keys follow the Sun, so no rate.
  const presetRate = !dynamic && !isCustom && s.pdkeycoeff > 0 ? formatKeyRate(1 / s.pdkeycoeff) : null;

  return (
    <div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-[var(--aries-control-gap)]">
        <SectionLabel searchAnchor="primdir.keys">{t("primdir.keys")}</SectionLabel>
        <ListSegmentedControl
          label={t("primdir.keys")}
          options={[
            { value: 0, label: t("primdir.dynamic") },
            { value: 1, label: t("primdir.static") },
          ] as const}
          value={dynamic ? 0 : 1}
          onChange={(v) => onPatch({ pdkeydyn: v === 0 })}
        />
      </div>
      <select
        data-aries-control-appearance="local"
        aria-label={t("primdir.keys")}
        value={presetSel}
        onChange={(e) =>
          onPatch(dynamic ? { pdkeyd: Number(e.target.value) } : { pdkeys: Number(e.target.value) })
        }
        className="mt-1 h-[var(--aries-control-height-compact)] w-full rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-control-outline)] bg-transparent px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-small)]"
      >
        {presetKeys.map((k, i) => (
          <option key={k} value={i}>
            {t(k)}
          </option>
        ))}
      </select>
      {isCustom ? (
        // The user's own rate (PrimDirs.CUSTOMER): degrees 0..9, minutes and
        // seconds 0..59 (primarydirsdlg.py:467). The daemon recalculates on commit.
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[length:var(--aries-font-size-small)] text-muted-foreground">
          <SmallNumberInput value={s.pdkeydeg} min={0} max={9} label={t("primdir.deg")} onCommit={(v) => onPatch({ pdkeydeg: v })} />
          <span aria-hidden>°</span>
          <SmallNumberInput value={s.pdkeymin} min={0} max={59} label={t("primdir.min")} onCommit={(v) => onPatch({ pdkeymin: v })} />
          <span aria-hidden>′</span>
          <SmallNumberInput value={s.pdkeysec} min={0} max={59} label={t("primdir.sec")} onCommit={(v) => onPatch({ pdkeysec: v })} />
          <span aria-hidden>″</span>
          <span>{t("primdir.perYear")}</span>
        </div>
      ) : presetRate ? (
        <div className="mt-0.5 px-1.5 text-[length:var(--aries-font-size-small)] text-muted-foreground tabular-nums">
          {t("primdir.keyRatePerYear", { rate: presetRate })}
        </div>
      ) : null}
    </div>
  );
}

/** Degrees per year as d°mm′ss″, rounded to the second. */
function formatKeyRate(degreesPerYear: number): string {
  const totalSeconds = Math.round(degreesPerYear * 3600);
  const deg = Math.floor(totalSeconds / 3600);
  const min = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return `${deg}°${String(min).padStart(2, "0")}′${String(sec).padStart(2, "0")}″`;
}
