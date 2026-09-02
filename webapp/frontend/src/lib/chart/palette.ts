// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Chart, ChartPalette, ChartPlanet, ChartRenderSnapshot } from "./types";
import type { ThemeState } from "@/lib/daemon/client";

// Neutral last-resort values for the named per-body / per-aspect CSS roles.
// Retained daemon snapshot arrays overlay these fallbacks, and active profile
// chartData arrays overlay the retained snapshot at final precedence.
const NEUTRAL_PLANET_COLORS: string[] = Array.from({ length: 13 }, () => "rgb(205,205,209)");
const NEUTRAL_ASPECT_COLORS: string[] = Array.from({ length: 14 }, () => "rgb(205,205,209)");

const BODY_COLOR_VARS = [
  "--morinus-body-sun",
  "--morinus-body-moon",
  "--morinus-body-mercury",
  "--morinus-body-venus",
  "--morinus-body-mars",
  "--morinus-body-jupiter",
  "--morinus-body-saturn",
  "--morinus-body-uranus",
  "--morinus-body-neptune",
  "--morinus-body-pluto",
  "--morinus-body-nodes",
  "--morinus-body-fortune",
  "--morinus-body-chiron",
] as const;

const ASPECT_COLOR_VARS = [
  "--morinus-aspect-conjunction",
  "--morinus-aspect-semisextile",
  "--morinus-aspect-semisquare",
  "--morinus-aspect-sextile",
  "--morinus-aspect-quintile",
  "--morinus-aspect-square",
  "--morinus-aspect-trine",
  "--morinus-aspect-sesquisquare",
  "--morinus-aspect-biquintile",
  "--morinus-aspect-quincunx",
  "--morinus-aspect-opposition",
  "--morinus-aspect-septile",
  "--morinus-aspect-parallel",
  "--morinus-aspect-contraparallel",
] as const;

const ELEMENT_COLOR_VARS = [
  "--morinus-element-fire",
  "--morinus-element-earth",
  "--morinus-element-air",
  "--morinus-element-water",
] as const;

const SIGN_ELEMENT_INDEX = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3] as const;

function parseCssRgbChannels(value: string | undefined): readonly [number, number, number] | null {
  if (!value) return null;
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16),
    ];
  }
  const functional = value.trim().match(
    /^rgba?\(\s*([\d.]+)(?:\s+|,\s*)([\d.]+)(?:\s+|,\s*)([\d.]+)(?:\s*[/,].*)?\)$/i,
  );
  if (!functional) return null;
  const channels = functional.slice(1, 4).map((channel) => (
    Math.min(255, Math.max(0, Number(channel)))
  ));
  return channels.every(Number.isFinite)
    ? [channels[0], channels[1], channels[2]]
    : null;
}

function deriveDimChartText(
  textBright: string | undefined,
  background: string | undefined,
): string | null {
  const foregroundChannels = parseCssRgbChannels(textBright);
  const backgroundChannels = parseCssRgbChannels(background);
  if (!foregroundChannels || !backgroundChannels) return null;
  const mixed = foregroundChannels.map((channel, index) => (
    Math.round((channel + backgroundChannels[index]) / 2)
  ));
  return `rgb(${mixed[0]} ${mixed[1]} ${mixed[2]})`;
}

export function neutralChartPalette(): ChartPalette {
  return {
    background: "rgb(35,36,40)",
    frame: "rgb(220,220,221)",
    signs: "rgb(215,215,217)",
    angles: "rgb(205,205,209)",
    houses: "rgb(138,139,141)",
    houseNums: "rgb(59,59,60)",
    positions: "rgb(255,255,255)",
    peregrin: "rgb(205,205,209)",
    domicil: "rgb(2,191,2)",
    exil: "rgb(255,0,0)",
    exal: "rgb(255,215,0)",
    casus: "rgb(205,92,92)",
    textDim: "rgb(120,121,123)",
    textBright: "rgb(220,220,221)",
    fortune: "rgb(215, 215, 217)",
    surveilAccent: "rgb(229,146,70)",
    planets: [...NEUTRAL_PLANET_COLORS],
    aspects: [...NEUTRAL_ASPECT_COLORS],
  };
}

/**
 * Resolves the theming glue from named CSS custom properties. The retained
 * daemon arrays still overlay this named-role fallback. Called per chart render.
 */
export function readPalette(el?: HTMLElement): ChartPalette {
  if (typeof document === "undefined") {
    return neutralChartPalette();
  }

  const target = el ?? document.documentElement;
  const style = getComputedStyle(target);
  const v = (name: string, fallback: string) =>
    (style.getPropertyValue(name).trim() || fallback) as string;
  const chartText = v("--morinus-text-bright", "rgb(255,255,255)");
  const frame = v("--morinus-frame", "rgb(220,220,221)");
  const peregrin = v("--morinus-peregrin", "rgb(205,205,209)");
  const planets = BODY_COLOR_VARS.map((name) => v(name, peregrin));
  const aspects = ASPECT_COLOR_VARS.map((name, index) => (
    v(name, index === 13 ? frame : chartText)
  ));

  return {
    background: v("--morinus-background", "rgb(35,36,40)"),
    frame,
    signs: v("--morinus-signs", "rgb(215,215,217)"),
    angles: v("--morinus-angles", "rgb(205,205,209)"),
    houses: v("--morinus-houses", "rgb(138,139,141)"),
    houseNums: v("--morinus-housenums", "rgb(59,59,60)"),
    positions: v("--morinus-positions", "rgb(255,255,255)"),
    peregrin,
    domicil: v("--morinus-dignity-domicil", "rgb(2,191,2)"),
    exil: v("--morinus-dignity-exil", "rgb(255,0,0)"),
    exal: v("--morinus-dignity-exal", "rgb(255,215,0)"),
    casus: v("--morinus-dignity-casus", "rgb(205,92,92)"),
    textDim: v("--morinus-text-dim", chartText),
    textBright: chartText,
    fortune: planets[11],
    // Warm surveil accent; daemon chart.palette.surveilAccent overrides this.
    surveilAccent: "rgb(229,146,70)",
    // Named roles are the defined fallback. A retained daemon snapshot still
    // overlays these arrays, and active profile chartData overlays that last.
    planets,
    aspects,
  };
}

export function readPaletteFromTheme(theme: ThemeState | null | undefined): ChartPalette {
  if (!theme) return readPalette();
  const chart = theme.chartPalette;
  const v = (tokens: Record<string, string>, name: string, fallback: string) =>
    tokens[name] || fallback;
  const chartBackground = v(chart, "--morinus-background", "rgb(35 36 40)");
  const chartText = v(chart, "--morinus-text-bright", "rgb(255 255 255)");
  const frame = v(chart, "--morinus-frame", "rgb(220 220 221)");
  const peregrin = v(chart, "--morinus-peregrin", "rgb(205 205 209)");
  const planets = BODY_COLOR_VARS.map((name) => v(chart, name, peregrin));
  const aspects = ASPECT_COLOR_VARS.map((name, index) => (
    v(chart, name, index === 13 ? frame : chartText)
  ));

  return {
    background: chartBackground,
    frame,
    signs: v(chart, "--morinus-signs", "rgb(215 215 217)"),
    angles: v(chart, "--morinus-angles", "rgb(205 205 209)"),
    houses: v(chart, "--morinus-houses", "rgb(138 139 141)"),
    houseNums: v(chart, "--morinus-housenums", "rgb(59 59 60)"),
    positions: v(chart, "--morinus-positions", "rgb(255 255 255)"),
    peregrin,
    domicil: v(chart, "--morinus-dignity-domicil", "rgb(2 191 2)"),
    exil: v(chart, "--morinus-dignity-exil", "rgb(255 0 0)"),
    exal: v(chart, "--morinus-dignity-exal", "rgb(255 215 0)"),
    casus: v(chart, "--morinus-dignity-casus", "rgb(205 92 92)"),
    textDim: v(chart, "--morinus-text-dim", chartText),
    textBright: chartText,
    fortune: planets[11],
    surveilAccent: "rgb(229,146,70)",
    planets,
    aspects,
  };
}

/** Explicit profile roles have higher precedence than a retained chart
 * snapshot. This is intentionally separate from the daemon base palette so a
 * profile can restyle an already-open chart without recalculation/refetch. */
export function readPaletteProfileOverrides(
  theme: ThemeState | null | undefined,
): Partial<ChartPalette> {
  const chart = theme?.profileOverrides?.chartPalette ?? {};
  const result: Partial<ChartPalette> = {};
  const copy = (key: keyof ChartPalette, cssVar: string) => {
    const value = chart[cssVar];
    if (value) Object.assign(result, { [key]: value });
  };
  copy("background", "--morinus-background");
  copy("frame", "--morinus-frame");
  copy("signs", "--morinus-signs");
  copy("angles", "--morinus-angles");
  copy("houses", "--morinus-houses");
  copy("houseNums", "--morinus-housenums");
  copy("positions", "--morinus-positions");
  copy("peregrin", "--morinus-peregrin");
  copy("domicil", "--morinus-dignity-domicil");
  copy("exil", "--morinus-dignity-exil");
  copy("exal", "--morinus-dignity-exal");
  copy("casus", "--morinus-dignity-casus");
  copy("textBright", "--morinus-text-bright");
  copy("textDim", "--morinus-text-dim");
  if (
    !chart["--morinus-text-dim"]
    && (chart["--morinus-background"] || chart["--morinus-text-bright"])
  ) {
    const effectiveChart = theme?.chartPalette ?? chart;
    result.textDim = deriveDimChartText(
      chart["--morinus-text-bright"] ?? effectiveChart["--morinus-text-bright"],
      chart["--morinus-background"] ?? effectiveChart["--morinus-background"],
    ) ?? result.textBright ?? effectiveChart["--morinus-text-bright"];
  }
  let namedPalette: ChartPalette | undefined;
  const named = () => {
    namedPalette ??= readPaletteFromTheme(theme);
    return namedPalette;
  };
  if (BODY_COLOR_VARS.some((cssVar) => Boolean(chart[cssVar]))) {
    result.planets = [...named().planets];
  }
  if (ASPECT_COLOR_VARS.some((cssVar) => Boolean(chart[cssVar]))) {
    result.aspects = [...named().aspects];
  }
  const data = theme?.profileOverrides?.chartData;
  // Daemon chartData is the fully resolved partial-array contract and remains
  // final over named CSS fallbacks and retained snapshot arrays.
  if (Array.isArray(data?.planets)) result.planets = [...data.planets];
  if (Array.isArray(data?.aspects)) result.aspects = [...data.aspects];
  return result;
}

function readProfileSignColors(
  theme: ThemeState | null | undefined,
): string[] | undefined {
  const data = theme?.profileOverrides?.chartData?.signColors;
  if (Array.isArray(data) && data.length) return [...data];
  const profileChart = theme?.profileOverrides?.chartPalette ?? {};
  const effectiveChart = theme?.chartPalette ?? profileChart;
  if (ELEMENT_COLOR_VARS.some((cssVar) => Boolean(profileChart[cssVar]))) {
    const elements = ELEMENT_COLOR_VARS.map((cssVar) => (
      effectiveChart[cssVar] || profileChart[cssVar] || effectiveChart["--morinus-signs"]
    ));
    if (elements.every((value): value is string => Boolean(value))) {
      return SIGN_ELEMENT_INDEX.map((index) => elements[index]);
    }
  }
  if (profileChart["--morinus-signs"]) {
    const color = effectiveChart["--morinus-signs"] || profileChart["--morinus-signs"];
    return Array.from({ length: 12 }, () => color);
  }
  return undefined;
}

function planetPaletteIndex(planet: ChartPlanet): number {
  if (planet.id === "nnode" || planet.id === "snode") return 10;
  if (planet.id === "chiron") return 12;
  return Math.max(0, Math.min(9, Number(planet.seId) || 0));
}

function profiledPlanetColor(
  planet: ChartPlanet,
  useIndividualColors: boolean,
  palette: Partial<ChartPalette>,
): string | undefined {
  if (useIndividualColors) return palette.planets?.[planetPaletteIndex(planet)];
  if (planet.id === "chiron") return palette.peregrin;
  switch (planet.dignity) {
    case "domicil": return palette.domicil;
    case "exil": return palette.exil;
    case "exal": return palette.exal;
    case "casus": return palette.casus;
    case "peregrin": return palette.peregrin;
    default: return palette.peregrin;
  }
}

function applyProfileColorsToChart(
  chart: Chart,
  palette: Partial<ChartPalette>,
  signColors: string[] | undefined,
): Chart {
  const useIndividualColors = Boolean(chart.options.useDignityColors);
  let changed = false;
  const planets = chart.planets.map((planet) => {
    const color = profiledPlanetColor(planet, useIndividualColors, palette);
    if (!color || color === planet.color) return planet;
    changed = true;
    return { ...planet, color };
  });

  const fortuneColor = useIndividualColors ? palette.planets?.[11] : palette.peregrin;
  let fortune = chart.fortune;
  if (fortune && fortuneColor && fortune.color !== fortuneColor) {
    changed = true;
    fortune = { ...fortune, color: fortuneColor };
  }
  let vertex = chart.vertex;
  if (vertex && palette.peregrin && vertex.color !== palette.peregrin) {
    changed = true;
    vertex = { ...vertex, color: palette.peregrin };
  }
  let syzygy = chart.syzygy;
  if (syzygy && palette.signs && syzygy.color !== palette.signs) {
    changed = true;
    syzygy = { ...syzygy, color: palette.signs };
  }
  const nextSignColors = signColors?.length
    ? [...signColors]
    : palette.signs
      ? Array.from({ length: 12 }, () => palette.signs as string)
      : undefined;
  let options = chart.options;
  if (nextSignColors) {
    changed = true;
    options = {
      ...options,
      signColors: nextSignColors,
      ...(signColors?.length
        ? { multiwheelSignColors: [...signColors] }
        : {}),
    };
  }
  return changed ? { ...chart, planets, fortune, vertex, syzygy, options } : chart;
}

/** Apply only the active profile layer to colors embedded in retained daemon
 * snapshots. Base snapshot data still wins over CSS fallbacks; explicit/base
 * profile roles then win over that retained data without a chart refetch. */
export function applyProfileColorsToSnapshot(
  snapshot: ChartRenderSnapshot,
  theme: ThemeState | null | undefined,
): ChartRenderSnapshot {
  const palette = readPaletteProfileOverrides(theme);
  const signColors = readProfileSignColors(theme);
  if (Object.keys(palette).length === 0 && !signColors?.length) return snapshot;
  const apply = (chart: Chart | null | undefined) => (
    chart ? applyProfileColorsToChart(chart, palette, signColors) : chart
  );
  return {
    ...snapshot,
    primaryChart: apply(snapshot.primaryChart) as Chart,
    comparisonChart: apply(snapshot.comparisonChart),
    radixChart: apply(snapshot.radixChart),
    displayAnchorChart: apply(snapshot.displayAnchorChart),
    rings: snapshot.rings?.map((chart) => apply(chart) as Chart),
  };
}
