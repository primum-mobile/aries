// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import Color from "colorjs.io";

/**
 * The chart colours a key colour may be drawn from, most representative first.
 *
 * Only structural roles are candidates. Body colours are deliberately excluded:
 * they are a near-fixed rainbow that changes little between themes, so ranking
 * them would return the same vivid Mars red whatever the wheel actually looks
 * like — the opposite of "the colour this chart is".
 */
export const CHART_KEY_COLOR_SOURCES = [
  { semanticId: "chart.color.background", cssVar: "--morinus-background" },
  { semanticId: "chart.color.frame", cssVar: "--morinus-frame" },
  { semanticId: "chart.color.signs", cssVar: "--morinus-signs" },
  { semanticId: "chart.color.positions", cssVar: "--morinus-positions" },
  { semanticId: "chart.color.angles", cssVar: "--morinus-angles" },
  { semanticId: "chart.color.houses", cssVar: "--morinus-houses" },
] as const satisfies readonly {
  semanticId: string;
  cssVar: `--${string}`;
}[];

/**
 * Below this OKLCH chroma a colour reads as grey. A near-neutral parchment
 * (#f4f2ed) sits near 0.006 and the default dark ground near 0.005, so a
 * threshold of 0.01 keeps an unpainted chart from claiming a hue it does not
 * really have.
 */
const ACHROMATIC_CHROMA = 0.01;

/**
 * The single colour that stands for a chart's appearance.
 *
 * Chosen as the most chromatic of the structural roles, ties going to the
 * earlier candidate. That responds to authoring the way a reader does: a deep
 * red ground makes red the chart's colour, and painting the house lines a lurid
 * green makes green the chart's colour, because in each case that is the thing
 * the eye takes the wheel's character from.
 *
 * Returns null when every candidate is grey or unparseable, which is the honest
 * answer for a monochrome chart: there is no hue to carry anywhere else.
 */
export function chartKeyColor(
  candidates: readonly (string | null | undefined)[],
): string | null {
  let keyColor: string | null = null;
  let keyChroma = ACHROMATIC_CHROMA;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new Color(candidate).to("oklch");
      const chroma = typeof parsed.c === "number" && Number.isFinite(parsed.c)
        ? parsed.c
        : 0;
      if (chroma <= keyChroma) continue;
      keyChroma = chroma;
      keyColor = parsed.to("srgb").toString({ format: "hex" });
    } catch {
      // An unreadable chart colour is skipped rather than defaulted, so a
      // damaged token cannot become the colour the whole interface follows.
    }
  }
  return keyColor;
}
