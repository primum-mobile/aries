// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import Color from "colorjs.io";

export type LinkedPaletteColorInput =
  | string
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export type LinkedPaletteHarmony =
  | "source"
  | "complementary"
  | "analogous"
  | "splitComplementary"
  | "triadic";

export type LinkedPaletteContrastTarget = "aa" | "aaa";
export type LinkedPaletteMode = "light" | "dark";

export const LINKED_PALETTE_SURFACE_ROLES = [
  "canvas",
  "sidebar",
  "titlebar",
  "statusbar",
  "panel",
  "inspector",
  "overlay",
  "popover",
  "control",
  "dataBody",
  "dataHeader",
] as const;

export type LinkedPaletteSurfaceRole =
  (typeof LINKED_PALETTE_SURFACE_ROLES)[number];

export interface LinkedPaletteInput {
  canvas: LinkedPaletteColorInput;
  accent: LinkedPaletteColorInput;
  harmony?: LinkedPaletteHarmony;
  contrastTarget?: LinkedPaletteContrastTarget;
  mode?: LinkedPaletteMode;
}

export interface LinkedPaletteSurfacePair {
  background: string;
  foreground: string;
}

export interface LinkedPaletteContrastCheck {
  id: string;
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
  passes: boolean;
}

export interface LinkedPaletteContrastReport {
  target: LinkedPaletteContrastTarget;
  primaryMinimum: number;
  checks: readonly LinkedPaletteContrastCheck[];
  minimumRatio: number;
  passes: boolean;
}

export interface LinkedPalette {
  mode: LinkedPaletteMode;
  harmony: LinkedPaletteHarmony;
  contrastTarget: LinkedPaletteContrastTarget;
  background: string;
  surface: string;
  surfaceSubtle: string;
  accent: string;
  accentForeground: string;
  border: string;
  textPrimary: string;
  textMuted: string;
  textDim: string;
  surfaces: Readonly<
    Record<LinkedPaletteSurfaceRole, LinkedPaletteSurfacePair>
  >;
  contrastReport: LinkedPaletteContrastReport;
}

type OpaqueRgb = Readonly<{ r: number; g: number; b: number }>;
type Rgba = Readonly<{ r: number; g: number; b: number; a: number }>;
type Oklch = Readonly<{ l: number; c: number; h: number }>;
type ContrastRequirement = Readonly<{
  color: OpaqueRgb;
  minimum: number;
}>;

const WHITE: OpaqueRgb = Object.freeze({ r: 1, g: 1, b: 1 });
const BLACK: OpaqueRgb = Object.freeze({ r: 0, g: 0, b: 0 });
const FALLBACK_CANVAS = "#f4f2ed";
const FALLBACK_ACCENT = "#1d63a8";
const MUTED_MINIMUM = 4.5;
const DIM_MINIMUM = 3;
const BOUNDARY_MINIMUM = 3;
const CONTRAST_SAFETY_MARGIN = 0.12;

const HARMONY_OFFSETS: Readonly<Record<LinkedPaletteHarmony, number>> =
  Object.freeze({
    source: 0,
    complementary: 180,
    analogous: 30,
    splitComplementary: 150,
    triadic: 120,
  });

function clamp(value: number, minimum = 0, maximum = 1): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedHue(value: number, fallback = 250): number {
  const hue = Number.isFinite(value) ? value : fallback;
  return ((hue % 360) + 360) % 360;
}

function finiteCoordinate(value: number | null, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function colorToRgba(color: Color): Rgba | null {
  try {
    const srgb = color.to("srgb").toGamut({ space: "srgb", method: "css" });
    const [red, green, blue] = srgb.coords;
    if (
      typeof red !== "number" ||
      typeof green !== "number" ||
      typeof blue !== "number" ||
      !Number.isFinite(red) ||
      !Number.isFinite(green) ||
      !Number.isFinite(blue)
    ) {
      return null;
    }
    return {
      r: clamp(red),
      g: clamp(green),
      b: clamp(blue),
      a: clamp(Number(srgb.alpha), 0, 1),
    };
  } catch {
    return null;
  }
}

function parseColor(
  input: LinkedPaletteColorInput,
  fallback: string,
): Rgba {
  try {
    if (typeof input !== "string") {
      const red = clamp(Number(input[0]), 0, 255) / 255;
      const green = clamp(Number(input[1]), 0, 255) / 255;
      const blue = clamp(Number(input[2]), 0, 255) / 255;
      const alphaValue = input.length > 3 ? Number(input[3]) : 1;
      const alpha = alphaValue > 1
        ? clamp(alphaValue, 0, 255) / 255
        : clamp(alphaValue, 0, 1);
      return { r: red, g: green, b: blue, a: alpha };
    }
    const parsed = colorToRgba(new Color(input));
    if (parsed) return parsed;
  } catch {
    // The portable palette API is deliberately fail-soft for imported themes.
  }
  return colorToRgba(new Color(fallback)) ?? { ...BLACK, a: 1 };
}

function composite(foreground: Rgba, background: OpaqueRgb): OpaqueRgb {
  const alpha = clamp(foreground.a);
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
  };
}

function opaque(color: Rgba): OpaqueRgb {
  return { r: color.r, g: color.g, b: color.b };
}

function colorFromOklch(value: Oklch): OpaqueRgb {
  try {
    const mapped = colorToRgba(
      new Color(
        "oklch",
        [
          clamp(value.l),
          clamp(value.c, 0, 0.5),
          normalizedHue(value.h),
        ],
        1,
      ),
    );
    if (mapped) return opaque(mapped);
  } catch {
    // Fall through to a neutral color with the requested perceptual lightness.
  }
  const neutral = colorToRgba(
    new Color("oklch", [clamp(value.l), 0, 0], 1),
  );
  return neutral ? opaque(neutral) : (value.l >= 0.5 ? WHITE : BLACK);
}

function toOklch(color: OpaqueRgb, fallbackHue = 250): Oklch {
  try {
    const converted = new Color(
      "srgb",
      [color.r, color.g, color.b],
      1,
    ).to("oklch");
    return {
      l: clamp(finiteCoordinate(converted.coords[0], 0.5)),
      c: clamp(finiteCoordinate(converted.coords[1], 0), 0, 0.5),
      h: normalizedHue(
        finiteCoordinate(converted.coords[2], fallbackHue),
        fallbackHue,
      ),
    };
  } catch {
    return { l: 0.5, c: 0, h: normalizedHue(fallbackHue) };
  }
}

function mixOklab(
  foreground: OpaqueRgb,
  background: OpaqueRgb,
  backgroundWeight: number,
): OpaqueRgb {
  const amount = clamp(backgroundWeight);
  try {
    const left = new Color(
      "srgb",
      [foreground.r, foreground.g, foreground.b],
      1,
    ).to("oklab");
    const right = new Color(
      "srgb",
      [background.r, background.g, background.b],
      1,
    ).to("oklab");
    const coords = [0, 1, 2].map((index) => {
      const start = finiteCoordinate(left.coords[index], 0);
      const end = finiteCoordinate(right.coords[index], 0);
      return start + (end - start) * amount;
    }) as [number, number, number];
    const mixed = colorToRgba(new Color("oklab", coords, 1));
    if (mixed) return opaque(mixed);
  } catch {
    // The linear-sRGB fallback below is finite for every normalized input.
  }
  return {
    r: foreground.r + (background.r - foreground.r) * amount,
    g: foreground.g + (background.g - foreground.g) * amount,
    b: foreground.b + (background.b - foreground.b) * amount,
  };
}

function linearChannel(channel: number): number {
  const value = clamp(channel);
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: OpaqueRgb): number {
  return (
    0.2126 * linearChannel(color.r) +
    0.7152 * linearChannel(color.g) +
    0.0722 * linearChannel(color.b)
  );
}

function contrastRatioRgb(first: OpaqueRgb, second: OpaqueRgb): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssColor(color: OpaqueRgb): string {
  const channels = [color.r, color.g, color.b].map((value) =>
    Math.round(clamp(value) * 255),
  );
  return `rgb(${channels[0]} ${channels[1]} ${channels[2]})`;
}

function opaqueFromInput(
  input: LinkedPaletteColorInput,
  background: OpaqueRgb,
  fallback = FALLBACK_CANVAS,
): OpaqueRgb {
  return composite(parseColor(input, fallback), background);
}

/**
 * WCAG 2.2 relative luminance. Translucent inputs are composited over white.
 */
export function wcagRelativeLuminance(
  color: LinkedPaletteColorInput,
): number {
  return luminance(opaqueFromInput(color, WHITE));
}

/**
 * WCAG 2.2 contrast ratio. A translucent foreground is composited over the
 * supplied background; a translucent background is composited over white.
 */
export function wcagContrastRatio(
  foreground: LinkedPaletteColorInput,
  background: LinkedPaletteColorInput,
): number {
  const opaqueBackground = opaqueFromInput(background, WHITE);
  const foregroundColor = composite(
    parseColor(foreground, "#000000"),
    opaqueBackground,
  );
  return contrastRatioRgb(foregroundColor, opaqueBackground);
}

export function meetsWcagContrast(
  foreground: LinkedPaletteColorInput,
  background: LinkedPaletteColorInput,
  minimum: number,
): boolean {
  return wcagContrastRatio(foreground, background) + 1e-9 >= minimum;
}

function passesRequirements(
  candidate: OpaqueRgb,
  requirements: readonly ContrastRequirement[],
): boolean {
  return requirements.every(
    ({ color, minimum }) =>
      contrastRatioRgb(candidate, color) + 1e-9 >= minimum,
  );
}

function tunedCandidate(
  source: OpaqueRgb,
  requirements: readonly ContrastRequirement[],
  direction: "darker" | "lighter",
): { color: OpaqueRgb; lightnessDelta: number } | null {
  if (passesRequirements(source, requirements)) {
    return { color: source, lightnessDelta: 0 };
  }
  const sourceOklch = toOklch(source);
  const end = direction === "darker" ? 0 : 1;
  let failedLightness = sourceOklch.l;
  let passedLightness: number | null = null;
  let passedColor: OpaqueRgb | null = null;

  for (let step = 1; step <= 256; step += 1) {
    const amount = step / 256;
    const lightness = sourceOklch.l + (end - sourceOklch.l) * amount;
    const candidate = colorFromOklch({ ...sourceOklch, l: lightness });
    if (passesRequirements(candidate, requirements)) {
      passedLightness = lightness;
      passedColor = candidate;
      break;
    }
    failedLightness = lightness;
  }
  if (passedLightness == null || !passedColor) return null;
  let refinedPassedLightness: number = passedLightness;
  let refinedPassedColor: OpaqueRgb = passedColor;

  for (let iteration = 0; iteration < 24; iteration += 1) {
    const midpoint: number = (failedLightness + refinedPassedLightness) / 2;
    const candidate = colorFromOklch({ ...sourceOklch, l: midpoint });
    if (passesRequirements(candidate, requirements)) {
      refinedPassedLightness = midpoint;
      refinedPassedColor = candidate;
    } else {
      failedLightness = midpoint;
    }
  }
  return {
    color: refinedPassedColor,
    lightnessDelta: Math.abs(refinedPassedLightness - sourceOklch.l),
  };
}

function ensureContrast(
  source: OpaqueRgb,
  requirements: readonly ContrastRequirement[],
  preferredDirection: "darker" | "lighter",
): OpaqueRgb {
  if (passesRequirements(source, requirements)) return source;
  const preferred = tunedCandidate(source, requirements, preferredDirection);
  const alternate = tunedCandidate(
    source,
    requirements,
    preferredDirection === "darker" ? "lighter" : "darker",
  );
  if (preferred && alternate) {
    return preferred.lightnessDelta <= alternate.lightnessDelta + 1e-9
      ? preferred.color
      : alternate.color;
  }
  if (preferred) return preferred.color;
  if (alternate) return alternate.color;

  const blackPasses = passesRequirements(BLACK, requirements);
  const whitePasses = passesRequirements(WHITE, requirements);
  if (blackPasses) return BLACK;
  if (whitePasses) return WHITE;
  const minimumRatio = (candidate: OpaqueRgb) =>
    Math.min(
      ...requirements.map(({ color }) => contrastRatioRgb(candidate, color)),
    );
  return minimumRatio(BLACK) >= minimumRatio(WHITE) ? BLACK : WHITE;
}

function primaryMinimum(target: LinkedPaletteContrastTarget): number {
  return target === "aaa" ? 7 : 4.5;
}

function contrastRequirement(
  color: OpaqueRgb,
  minimum: number,
): ContrastRequirement {
  return { color, minimum: minimum + CONTRAST_SAFETY_MARGIN };
}

function paletteMode(
  canvas: Rgba,
  explicitMode?: LinkedPaletteMode,
): LinkedPaletteMode {
  if (explicitMode) return explicitMode;
  return luminance(opaque(canvas)) < 0.32 ? "dark" : "light";
}

function rolePairs(
  background: string,
  surface: string,
  surfaceSubtle: string,
  textPrimary: string,
): Record<LinkedPaletteSurfaceRole, LinkedPaletteSurfacePair> {
  return {
    canvas: { background, foreground: textPrimary },
    sidebar: { background: surface, foreground: textPrimary },
    titlebar: { background: surface, foreground: textPrimary },
    statusbar: { background: surfaceSubtle, foreground: textPrimary },
    panel: { background: surface, foreground: textPrimary },
    inspector: { background: surface, foreground: textPrimary },
    overlay: { background: surfaceSubtle, foreground: textPrimary },
    popover: { background: surface, foreground: textPrimary },
    control: { background: surfaceSubtle, foreground: textPrimary },
    dataBody: { background, foreground: textPrimary },
    dataHeader: { background: surfaceSubtle, foreground: textPrimary },
  };
}

function contrastCheck(
  id: string,
  foreground: string,
  background: string,
  minimum: number,
): LinkedPaletteContrastCheck {
  const ratio = wcagContrastRatio(foreground, background);
  return {
    id,
    foreground,
    background,
    ratio,
    minimum,
    passes: ratio + 1e-9 >= minimum,
  };
}

export function buildLinkedPaletteContrastReport(
  palette: Omit<LinkedPalette, "contrastReport">,
): LinkedPaletteContrastReport {
  const primary = primaryMinimum(palette.contrastTarget);
  const checks: LinkedPaletteContrastCheck[] = [];
  for (const [role, pair] of Object.entries(palette.surfaces)) {
    checks.push(
      contrastCheck(
        `surface.${role}.foreground`,
        pair.foreground,
        pair.background,
        primary,
      ),
    );
  }
  for (const [name, background] of [
    ["background", palette.background],
    ["surface", palette.surface],
    ["surfaceSubtle", palette.surfaceSubtle],
  ] as const) {
    checks.push(
      contrastCheck(
        `textPrimary.${name}`,
        palette.textPrimary,
        background,
        primary,
      ),
      contrastCheck(
        `textMuted.${name}`,
        palette.textMuted,
        background,
        MUTED_MINIMUM,
      ),
      contrastCheck(
        `textDim.${name}`,
        palette.textDim,
        background,
        DIM_MINIMUM,
      ),
      contrastCheck(
        `border.${name}`,
        palette.border,
        background,
        BOUNDARY_MINIMUM,
      ),
    );
  }
  checks.push(
    contrastCheck(
      "control.boundary",
      palette.accent,
      palette.background,
      BOUNDARY_MINIMUM,
    ),
    contrastCheck(
      "control.foreground",
      palette.accentForeground,
      palette.accent,
      primary,
    ),
  );
  return {
    target: palette.contrastTarget,
    primaryMinimum: primary,
    checks,
    minimumRatio: Math.min(...checks.map((check) => check.ratio)),
    passes: checks.every((check) => check.passes),
  };
}

/**
 * Derive a complete app palette from two portable color anchors.
 *
 * Canvas colors are kept in a restrained OKLCH range so text hierarchy remains
 * usable. Harmony changes only the accent hue. Contrast repair changes
 * lightness first and lets Color.js's CSS gamut mapper reduce chroma only where
 * sRGB requires it.
 */
export function deriveLinkedPalette(input: LinkedPaletteInput): LinkedPalette {
  const harmony = input.harmony ?? "source";
  const contrastTarget = input.contrastTarget ?? "aa";
  const rawCanvas = parseColor(input.canvas, FALLBACK_CANVAS);
  const mode = paletteMode(rawCanvas, input.mode);
  const canvasBackdrop = mode === "dark" ? BLACK : WHITE;
  const canvasAnchor = composite(rawCanvas, canvasBackdrop);
  const accentAnchor = composite(
    parseColor(input.accent, FALLBACK_ACCENT),
    canvasAnchor,
  );

  const accentOklch = toOklch(accentAnchor);
  const canvasOklch = toOklch(canvasAnchor, accentOklch.h);
  const baseHue = canvasOklch.c > 0.002 ? canvasOklch.h : accentOklch.h;
  const baseLightness = mode === "light"
    ? clamp(canvasOklch.l, 0.88, 0.98)
    : clamp(canvasOklch.l, 0.08, 0.24);
  const baseChroma = Math.min(canvasOklch.c, mode === "light" ? 0.08 : 0.1);

  const backgroundRgb = colorFromOklch({
    l: baseLightness,
    c: baseChroma,
    h: baseHue,
  });
  const surfaceRgb = colorFromOklch({
    l: mode === "light"
      ? Math.min(0.995, baseLightness + 0.018)
      : Math.min(0.34, baseLightness + 0.04),
    c: baseChroma * 0.9,
    h: baseHue,
  });
  const surfaceSubtleRgb = colorFromOklch({
    l: mode === "light"
      ? Math.max(0.75, baseLightness - 0.035)
      : Math.min(0.4, baseLightness + 0.075),
    c: baseChroma * 0.82,
    h: baseHue,
  });
  const baseSurfaces = [backgroundRgb, surfaceRgb, surfaceSubtleRgb];
  const textDirection = mode === "light" ? "darker" : "lighter";
  const primaryTarget = primaryMinimum(contrastTarget);
  const primarySeed = colorFromOklch({
    l: mode === "light" ? 0.16 : 0.94,
    c: Math.min(0.025, Math.max(baseChroma * 0.35, 0.008)),
    h: baseHue,
  });
  const textPrimaryRgb = ensureContrast(
    primarySeed,
    baseSurfaces.map((color) => contrastRequirement(color, primaryTarget)),
    textDirection,
  );
  const mutedRgb = ensureContrast(
    mixOklab(textPrimaryRgb, backgroundRgb, 0.36),
    baseSurfaces.map((color) => contrastRequirement(color, MUTED_MINIMUM)),
    textDirection,
  );
  const dimRgb = ensureContrast(
    mixOklab(textPrimaryRgb, backgroundRgb, 0.56),
    baseSurfaces.map((color) => contrastRequirement(color, DIM_MINIMUM)),
    textDirection,
  );
  const borderRgb = ensureContrast(
    mixOklab(textPrimaryRgb, backgroundRgb, 0.62),
    baseSurfaces.map((color) => contrastRequirement(color, BOUNDARY_MINIMUM)),
    textDirection,
  );

  const accentHue = normalizedHue(
    accentOklch.h + HARMONY_OFFSETS[harmony],
    baseHue,
  );
  const accentSeed = colorFromOklch({
    l: accentOklch.l,
    c: Math.min(accentOklch.c, 0.32),
    h: accentHue,
  });
  const controlForegroundRgb = mode === "light" ? WHITE : BLACK;
  const accentRgb = ensureContrast(
    accentSeed,
    [
      contrastRequirement(backgroundRgb, BOUNDARY_MINIMUM),
      contrastRequirement(controlForegroundRgb, primaryTarget),
    ],
    mode === "light" ? "darker" : "lighter",
  );

  const background = cssColor(backgroundRgb);
  const surface = cssColor(surfaceRgb);
  const surfaceSubtle = cssColor(surfaceSubtleRgb);
  const accent = cssColor(accentRgb);
  const accentForeground = cssColor(controlForegroundRgb);
  const border = cssColor(borderRgb);
  const textPrimary = cssColor(textPrimaryRgb);
  const textMuted = cssColor(mutedRgb);
  const textDim = cssColor(dimRgb);
  const surfaces = rolePairs(
    background,
    surface,
    surfaceSubtle,
    textPrimary,
  );
  const paletteWithoutReport = {
    mode,
    harmony,
    contrastTarget,
    background,
    surface,
    surfaceSubtle,
    accent,
    accentForeground,
    border,
    textPrimary,
    textMuted,
    textDim,
    surfaces,
  };
  return {
    ...paletteWithoutReport,
    contrastReport: buildLinkedPaletteContrastReport(paletteWithoutReport),
  };
}
