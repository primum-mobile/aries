// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import Color from "colorjs.io";
import { expect, test } from "@playwright/test";

import {
  chartKeyColor,
  CHART_KEY_COLOR_SOURCES,
} from "../src/lib/theme/chart-key-color";
import {
  deriveLinkedPalette,
  harmonizeToward,
  LINKED_PALETTE_SURFACE_ROLES,
  meetsWcagContrast,
  wcagContrastRatio,
  type LinkedPalette,
  type LinkedPaletteHarmony,
} from "../src/lib/theme/linked-palette";

const HARMONIES: readonly LinkedPaletteHarmony[] = [
  "source",
  "complementary",
  "analogous",
  "splitComplementary",
  "triadic",
];

function paletteColors(palette: LinkedPalette): string[] {
  return [
    palette.background,
    palette.surface,
    palette.surfaceSubtle,
    palette.accent,
    palette.accentForeground,
    palette.border,
    palette.textPrimary,
    palette.textMuted,
    palette.textDim,
    ...Object.values(palette.surfaces).flatMap((pair) => [
      pair.background,
      pair.foreground,
    ]),
  ];
}

function expectSrgbColor(color: string) {
  const match = color.match(/^rgb\((\d+) (\d+) (\d+)\)$/);
  expect(match, color).not.toBeNull();
  for (const channel of match!.slice(1).map(Number)) {
    expect(Number.isFinite(channel), color).toBe(true);
    expect(channel, color).toBeGreaterThanOrEqual(0);
    expect(channel, color).toBeLessThanOrEqual(255);
  }
}

function expectContrastContract(palette: LinkedPalette) {
  const primaryMinimum = palette.contrastTarget === "aaa" ? 7 : 4.5;
  expect(palette.contrastReport.passes).toBe(true);
  expect(palette.contrastReport.primaryMinimum).toBe(primaryMinimum);
  for (const role of LINKED_PALETTE_SURFACE_ROLES) {
    const pair = palette.surfaces[role];
    expect(
      wcagContrastRatio(pair.foreground, pair.background),
      role,
    ).toBeGreaterThanOrEqual(primaryMinimum);
  }
  for (const background of [
    palette.background,
    palette.surface,
    palette.surfaceSubtle,
  ]) {
    expect(wcagContrastRatio(palette.textPrimary, background))
      .toBeGreaterThanOrEqual(primaryMinimum);
    expect(wcagContrastRatio(palette.textMuted, background))
      .toBeGreaterThanOrEqual(4.5);
    expect(wcagContrastRatio(palette.textDim, background))
      .toBeGreaterThanOrEqual(3);
    expect(wcagContrastRatio(palette.border, background))
      .toBeGreaterThanOrEqual(3);
  }
  expect(meetsWcagContrast(palette.accent, palette.background, 3)).toBe(true);
  expect(
    wcagContrastRatio(palette.accentForeground, palette.accent),
  ).toBeGreaterThanOrEqual(primaryMinimum);
  expect(palette.surfaces.control).toEqual({
    background: palette.surfaceSubtle,
    foreground: palette.textPrimary,
  });
}

test("linked palettes meet their complete light and dark contrast contracts", () => {
  const light = deriveLinkedPalette({
    canvas: "#f4efe2",
    accent: "#087ca7",
    harmony: "analogous",
    contrastTarget: "aa",
    mode: "light",
  });
  const dark = deriveLinkedPalette({
    canvas: "#171b23",
    accent: "#d78d32",
    harmony: "splitComplementary",
    contrastTarget: "aaa",
    mode: "dark",
  });

  expect(light.mode).toBe("light");
  expect(dark.mode).toBe("dark");
  expectContrastContract(light);
  expectContrastContract(dark);
});

test("all harmonies are deterministic, bounded sRGB palettes", () => {
  const accents = new Set<string>();
  for (const harmony of HARMONIES) {
    const input = {
      canvas: [238, 243, 248] as const,
      accent: [195, 48, 92, 0.9] as const,
      harmony,
      contrastTarget: "aa" as const,
    };
    const first = deriveLinkedPalette(input);
    const second = deriveLinkedPalette(input);
    expect(first).toEqual(second);
    expect(first.harmony).toBe(harmony);
    expectContrastContract(first);
    for (const color of paletteColors(first)) expectSrgbColor(color);
    accents.add(first.accent);
  }
  expect(accents.size).toBe(HARMONIES.length);
});

test("neutral and translucent anchors remain finite and accessible", () => {
  const palette = deriveLinkedPalette({
    canvas: [127, 127, 127, 180],
    accent: [127, 127, 127, 0.45],
    harmony: "complementary",
    contrastTarget: "aaa",
  });
  expect(["light", "dark"]).toContain(palette.mode);
  expectContrastContract(palette);
  for (const color of paletteColors(palette)) {
    expectSrgbColor(color);
    expect(color).not.toContain("NaN");
  }
});

test("invalid imported anchors fail soft without non-finite output", () => {
  const palette = deriveLinkedPalette({
    canvas: "not-a-color",
    accent: "also-not-a-color",
    harmony: "triadic",
    contrastTarget: "aaa",
    mode: "light",
  });
  expectContrastContract(palette);
  for (const color of paletteColors(palette)) expectSrgbColor(color);
});

test("contrast helpers account for translucent foregrounds", () => {
  expect(wcagContrastRatio("rgb(0 0 0 / 50%)", "#ffffff"))
    .toBeCloseTo(3.98, 1);
  expect(meetsWcagContrast("#000000", "#ffffff", 7)).toBe(true);
  expect(meetsWcagContrast("#777777", "#ffffff", 4.5)).toBe(false);
});

test("the chart key colour is the most chromatic structural colour", () => {
  // Grey ground, deep red frame: the frame is what the chart looks like.
  expect(chartKeyColor(["#232428", "#7a1f1f", "#d7d7d9"]))
    .toBe("#7a1f1f");
  // Position never beats chroma: the lurid green house lines win even last.
  expect(chartKeyColor(["#7a1f1f", "#1f7a1f"])).toBe("#1f7a1f");
  // A tie goes to the earlier, more representative candidate.
  expect(chartKeyColor(["#7a1f1f", "#7a1f1f"])).toBe("#7a1f1f");
  // A monochrome chart has no hue to carry anywhere, and says so.
  expect(chartKeyColor(["#f4f2ed", "#232428", "#d7d7d9"])).toBeNull();
  expect(chartKeyColor([null, undefined, "not-a-color"])).toBeNull();
  expect(chartKeyColor([])).toBeNull();
  // Every source names both the token an edit writes and the variable the
  // wheel is painted from, so the key resolves before a theme is loaded.
  for (const source of CHART_KEY_COLOR_SOURCES) {
    expect(source.semanticId.startsWith("chart.color.")).toBe(true);
    expect(source.cssVar.startsWith("--morinus-")).toBe(true);
  }
});

test("harmonising the anchors keeps every contrast contract", () => {
  const chartKey = "#7a1f1f";
  for (const amount of [0.15, 0.5, 1]) {
    const palette = deriveLinkedPalette({
      canvas: harmonizeToward("#f4f2ed", chartKey, amount),
      accent: harmonizeToward("#2f6feb", chartKey, amount),
      contrastTarget: "aaa",
      mode: "light",
    });
    expectContrastContract(palette);
    for (const color of paletteColors(palette)) expectSrgbColor(color);
  }
});

test("harmonisation moves hue alone, and fails soft", () => {
  const before = new Color("#2f6feb").to("oklch");
  const after = new Color(harmonizeToward("#2f6feb", "#7a1f1f", 0.15)).to("oklch");
  expect(Number(after.coords[0])).toBeCloseTo(Number(before.coords[0]), 2);
  expect(Number(after.coords[1])).toBeCloseTo(Number(before.coords[1]), 2);
  expect(Number(after.coords[2])).toBeGreaterThan(Number(before.coords[2]));
  // A colour with no hue to travel toward, and an unreadable one, are returned
  // untouched: a theme is better unharmonised than wrong.
  expect(harmonizeToward("#2f6feb", "#808080", 0.15)).toBe("#2f6feb");
  expect(harmonizeToward("not-a-color", "#7a1f1f", 0.15)).toBe("not-a-color");
  expect(harmonizeToward("#2f6feb", "#7a1f1f", 0)).toBe("#2f6feb");
});
