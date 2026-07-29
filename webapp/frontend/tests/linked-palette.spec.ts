// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  deriveLinkedPalette,
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
