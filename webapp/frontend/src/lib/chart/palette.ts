// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartPalette } from "./types";
import type { ThemeState } from "@/lib/daemon/client";

// Neutral fallbacks for the per-body / per-aspect color arrays. The real
// values are the daemon `chart.palette.planets` / `chart.palette.aspects`
// arrays (export_chart_json options.palette), which the chart canvas spreads
// OVER this base. These exist only so the renderer has a defined-length array
// before the daemon palette merges in — no Midnight-specific color logic here.
const NEUTRAL_PLANET_COLORS: string[] = Array.from({ length: 13 }, () => "rgb(205,205,209)");
const NEUTRAL_ASPECT_COLORS: string[] = Array.from({ length: 14 }, () => "rgb(205,205,209)");

/**
 * Resolves the theming glue from CSS custom properties defined in globals.css.
 * The per-body/per-aspect color ARRAYS come from the daemon snapshot; this only
 * provides neutral array fallbacks. Called once per chart render.
 */
export function readPalette(el?: HTMLElement): ChartPalette {
  if (typeof document === "undefined") {
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
      planets: NEUTRAL_PLANET_COLORS,
      aspects: NEUTRAL_ASPECT_COLORS,
    };
  }

  const target = el ?? document.documentElement;
  const style = getComputedStyle(target);
  const v = (name: string, fallback: string) =>
    (style.getPropertyValue(name).trim() || fallback) as string;

  return {
    background: v("--background", "rgb(35,36,40)"),
    frame: v("--morinus-frame", "rgb(220,220,221)"),
    signs: v("--morinus-signs", "rgb(215,215,217)"),
    angles: v("--morinus-angles", "rgb(205,205,209)"),
    houses: v("--morinus-houses", "rgb(138,139,141)"),
    houseNums: v("--morinus-housenums", "rgb(59,59,60)"),
    positions: v("--morinus-positions", "rgb(255,255,255)"),
    peregrin: v("--morinus-peregrin", "rgb(205,205,209)"),
    domicil: v("--morinus-dignity-domicil", "rgb(2,191,2)"),
    exil: v("--morinus-dignity-exil", "rgb(255,0,0)"),
    exal: v("--morinus-dignity-exal", "rgb(255,215,0)"),
    casus: v("--morinus-dignity-casus", "rgb(205,92,92)"),
    textDim: v("--muted-foreground", "rgb(120,121,123)"),
    textBright: v("--foreground", "rgb(220,220,221)"),
    fortune: "rgb(215, 215, 217)",
    // Warm surveil accent; daemon chart.palette.surveilAccent overrides this.
    surveilAccent: "rgb(229,146,70)",
    // Per-body / per-aspect color arrays come from the daemon snapshot
    // (chart.palette.planets / chart.palette.aspects). These neutral arrays are
    // only a defined-length base that the daemon palette overrides.
    planets: NEUTRAL_PLANET_COLORS,
    aspects: NEUTRAL_ASPECT_COLORS,
  };
}

export function readPaletteFromTheme(theme: ThemeState | null | undefined): ChartPalette {
  if (!theme) return readPalette();
  const app = theme.appTokens;
  const chart = theme.chartPalette;
  const v = (tokens: Record<string, string>, name: string, fallback: string) =>
    tokens[name] || fallback;

  return {
    background: v(app, "--aries-background", v(app, "--background", "rgb(35 36 40)")),
    frame: v(chart, "--morinus-frame", "rgb(220 220 221)"),
    signs: v(chart, "--morinus-signs", "rgb(215 215 217)"),
    angles: v(chart, "--morinus-angles", "rgb(205 205 209)"),
    houses: v(chart, "--morinus-houses", "rgb(138 139 141)"),
    houseNums: v(chart, "--morinus-housenums", "rgb(59 59 60)"),
    positions: v(chart, "--morinus-positions", "rgb(255 255 255)"),
    peregrin: v(chart, "--morinus-peregrin", "rgb(205 205 209)"),
    domicil: v(chart, "--morinus-dignity-domicil", "rgb(2 191 2)"),
    exil: v(chart, "--morinus-dignity-exil", "rgb(255 0 0)"),
    exal: v(chart, "--morinus-dignity-exal", "rgb(255 215 0)"),
    casus: v(chart, "--morinus-dignity-casus", "rgb(205 92 92)"),
    textDim: v(app, "--aries-text-dim", v(app, "--muted-foreground", "rgb(120 121 123)")),
    textBright: v(app, "--aries-text-primary", v(app, "--foreground", "rgb(220 220 221)")),
    fortune: "rgb(215, 215, 217)",
    surveilAccent: "rgb(229,146,70)",
    planets: NEUTRAL_PLANET_COLORS,
    aspects: NEUTRAL_ASPECT_COLORS,
  };
}
