// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const SPHERE_RENDER_STYLE_SCHEMA_VERSION = 1 as const;

export type SphereStyleRevision = string | number;

export type SphereRenderPalette = Readonly<{
  background: string;
  wire: string;
  faintWire: string;
}>;

export type SphereRenderTokens = {
  radiusScale: number;
  frameWidthMin: number;
  frameWidthDivisor: number;
  polylineWidthMin: number;
  widthScaleMin: number;
  widthScaleDivisor: number;
  dotRadiusMin: number;
  dotRadiusDivisor: number;
  bodyFontMin: number;
  bodyFontMax: number;
  bodyFontDivisor: number;
  signFontMin: number;
  signFontMax: number;
  signFontDivisor: number;
  houseFontMin: number;
  houseFontMax: number;
  houseFontDivisor: number;
  decanFontMin: number;
  decanFontMax: number;
  decanFontDivisor: number;
  boundFontMin: number;
  boundFontMax: number;
  boundFontDivisor: number;
  referenceTickFrontOpacity: number;
  referenceTickBackOpacity: number;
  referenceFrontOpacity: number;
  referenceBackOpacity: number;
  signBoundaryFrontOpacity: number;
  signBoundaryBackOpacity: number;
  decanBoundaryFrontOpacity: number;
  decanBoundaryBackOpacity: number;
  houseBoundaryFrontOpacity: number;
  houseBoundaryBackOpacity: number;
  boundTickFrontOpacity: number;
  boundTickBackOpacity: number;
  bodyFrontOpacity: number;
  bodyBackOpacity: number;
  signLabelFrontOpacity: number;
  signLabelBackOpacity: number;
  houseLabelFrontOpacity: number;
  houseLabelBackOpacity: number;
  decanLabelOpacity: number;
  boundLabelOpacity: number;
};

type SphereRenderTokenSpecs = {
  readonly [K in keyof SphereRenderTokens]: readonly [cssVar: string, fallback: number];
};

type SpherePaletteSpecs = {
  readonly [K in keyof SphereRenderPalette]: readonly [cssVar: string, fallback: string];
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export const SPHERE_RENDER_TOKEN_SPECS: Readonly<SphereRenderTokenSpecs> = deepFreeze({
  radiusScale: ["--aries-sphere-radius-scale", 0.43],
  frameWidthMin: ["--aries-sphere-frame-width-min", 0.75],
  frameWidthDivisor: ["--aries-sphere-frame-width-divisor", 520],
  polylineWidthMin: ["--aries-sphere-polyline-width-min", 0.35],
  widthScaleMin: ["--aries-sphere-width-scale-min", 0.55],
  widthScaleDivisor: ["--aries-sphere-width-scale-divisor", 440],
  dotRadiusMin: ["--aries-sphere-dot-radius-min", 0.75],
  dotRadiusDivisor: ["--aries-sphere-dot-radius-divisor", 360],
  bodyFontMin: ["--aries-sphere-body-font-min", 10],
  bodyFontMax: ["--aries-sphere-body-font-max", 16],
  bodyFontDivisor: ["--aries-sphere-body-font-divisor", 21],
  signFontMin: ["--aries-sphere-sign-font-min", 8],
  signFontMax: ["--aries-sphere-sign-font-max", 12],
  signFontDivisor: ["--aries-sphere-sign-font-divisor", 31],
  houseFontMin: ["--aries-sphere-house-font-min", 6],
  houseFontMax: ["--aries-sphere-house-font-max", 9],
  houseFontDivisor: ["--aries-sphere-house-font-divisor", 44],
  decanFontMin: ["--aries-sphere-decan-font-min", 5],
  decanFontMax: ["--aries-sphere-decan-font-max", 7],
  decanFontDivisor: ["--aries-sphere-decan-font-divisor", 68],
  boundFontMin: ["--aries-sphere-bound-font-min", 4],
  boundFontMax: ["--aries-sphere-bound-font-max", 6],
  boundFontDivisor: ["--aries-sphere-bound-font-divisor", 78],
  referenceTickFrontOpacity: ["--aries-sphere-reference-tick-front-opacity", 0.72],
  referenceTickBackOpacity: ["--aries-sphere-reference-tick-back-opacity", 0.08],
  referenceFrontOpacity: ["--aries-sphere-reference-front-opacity", 0.9],
  referenceBackOpacity: ["--aries-sphere-reference-back-opacity", 0.12],
  signBoundaryFrontOpacity: ["--aries-sphere-sign-boundary-front-opacity", 0.9],
  signBoundaryBackOpacity: ["--aries-sphere-sign-boundary-back-opacity", 0.1],
  decanBoundaryFrontOpacity: ["--aries-sphere-decan-boundary-front-opacity", 0.25],
  decanBoundaryBackOpacity: ["--aries-sphere-decan-boundary-back-opacity", 0.04],
  houseBoundaryFrontOpacity: ["--aries-sphere-house-boundary-front-opacity", 0.9],
  houseBoundaryBackOpacity: ["--aries-sphere-house-boundary-back-opacity", 0.1],
  boundTickFrontOpacity: ["--aries-sphere-bound-tick-front-opacity", 0.55],
  boundTickBackOpacity: ["--aries-sphere-bound-tick-back-opacity", 0.05],
  bodyFrontOpacity: ["--aries-sphere-body-front-opacity", 0.94],
  bodyBackOpacity: ["--aries-sphere-body-back-opacity", 0.16],
  signLabelFrontOpacity: ["--aries-sphere-sign-label-front-opacity", 0.76],
  signLabelBackOpacity: ["--aries-sphere-sign-label-back-opacity", 0.08],
  houseLabelFrontOpacity: ["--aries-sphere-house-label-front-opacity", 0.66],
  houseLabelBackOpacity: ["--aries-sphere-house-label-back-opacity", 0.08],
  decanLabelOpacity: ["--aries-sphere-decan-label-opacity", 0.35],
  boundLabelOpacity: ["--aries-sphere-bound-label-opacity", 0.32],
});

export const SPHERE_RENDER_PALETTE_SPECS: Readonly<SpherePaletteSpecs> = deepFreeze({
  background: ["--aries-sphere-background", "#000000"],
  wire: ["--aries-sphere-wire", "#ffffff"],
  faintWire: ["--aries-sphere-wire-faint", "rgba(255,255,255,0.22)"],
});

const POSITIVE_SPHERE_TOKEN_KEYS = new Set<keyof SphereRenderTokens>([
  "radiusScale",
  "frameWidthDivisor",
  "widthScaleDivisor",
  "dotRadiusDivisor",
  "bodyFontMax",
  "bodyFontDivisor",
  "signFontMax",
  "signFontDivisor",
  "houseFontMax",
  "houseFontDivisor",
  "decanFontMax",
  "decanFontDivisor",
  "boundFontMax",
  "boundFontDivisor",
]);

function defaultRenderTokens(): Readonly<SphereRenderTokens> {
  const tokens = {} as SphereRenderTokens;
  for (const key of Object.keys(SPHERE_RENDER_TOKEN_SPECS) as Array<keyof SphereRenderTokens>) {
    tokens[key] = SPHERE_RENDER_TOKEN_SPECS[key][1];
  }
  return deepFreeze(tokens);
}

function defaultRenderPalette(): SphereRenderPalette {
  const palette = {} as Record<keyof SphereRenderPalette, string>;
  for (const key of Object.keys(SPHERE_RENDER_PALETTE_SPECS) as Array<keyof SphereRenderPalette>) {
    palette[key] = SPHERE_RENDER_PALETTE_SPECS[key][1];
  }
  return deepFreeze(palette) as SphereRenderPalette;
}

export const DEFAULT_SPHERE_RENDER_TOKENS = defaultRenderTokens();
export const DEFAULT_SPHERE_RENDER_PALETTE = defaultRenderPalette();

export type SphereFontMetric = Readonly<{
  min: number;
  max: number;
  divisor: number;
}>;

export interface SphereRenderStyle {
  readonly schemaVersion: typeof SPHERE_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: SphereStyleRevision;
  readonly palette: SphereRenderPalette;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    body: SphereFontMetric;
    sign: SphereFontMetric;
    house: SphereFontMetric;
    decan: SphereFontMetric;
    bound: SphereFontMetric;
  }>;
  readonly strokes: Readonly<{
    frameWidthMin: number;
    frameWidthDivisor: number;
    polylineWidthMin: number;
    widthScaleMin: number;
    widthScaleDivisor: number;
    dotRadiusMin: number;
    dotRadiusDivisor: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
  }>;
  readonly layout: Readonly<{
    radiusScale: number;
  }>;
  readonly opacities: Readonly<{
    referenceTick: Readonly<{ front: number; back: number }>;
    reference: Readonly<{ front: number; back: number }>;
    signBoundary: Readonly<{ front: number; back: number }>;
    decanBoundary: Readonly<{ front: number; back: number }>;
    houseBoundary: Readonly<{ front: number; back: number }>;
    boundTick: Readonly<{ front: number; back: number }>;
    body: Readonly<{ front: number; back: number }>;
    signLabel: Readonly<{ front: number; back: number }>;
    houseLabel: Readonly<{ front: number; back: number }>;
    decanLabel: number;
    boundLabel: number;
  }>;
}

export type SphereCssValueReader = (cssVar: string) => string;

export function resolveSphereRenderTokens(
  readCssValue: SphereCssValueReader = () => "",
): Readonly<SphereRenderTokens> {
  const tokens = {} as SphereRenderTokens;
  for (const key of Object.keys(SPHERE_RENDER_TOKEN_SPECS) as Array<keyof SphereRenderTokens>) {
    const [cssVar, fallback] = SPHERE_RENDER_TOKEN_SPECS[key];
    const value = Number.parseFloat(readCssValue(cssVar).trim());
    const valid = Number.isFinite(value) && (
      POSITIVE_SPHERE_TOKEN_KEYS.has(key) ? value > 0 : value >= 0
    );
    tokens[key] = valid ? value : fallback;
  }
  return deepFreeze(tokens);
}

export function resolveSphereRenderPalette(
  readCssValue: SphereCssValueReader = () => "",
): SphereRenderPalette {
  const palette = {} as Record<keyof SphereRenderPalette, string>;
  for (const key of Object.keys(SPHERE_RENDER_PALETTE_SPECS) as Array<keyof SphereRenderPalette>) {
    const [cssVar, fallback] = SPHERE_RENDER_PALETTE_SPECS[key];
    palette[key] = readCssValue(cssVar).trim() || fallback;
  }
  return deepFreeze(palette) as SphereRenderPalette;
}

function readSphereRenderValues(host: HTMLElement | null): {
  tokens: Readonly<SphereRenderTokens>;
  palette: SphereRenderPalette;
} {
  const computed = host ? window.getComputedStyle(host) : null;
  const read = (cssVar: string) => computed?.getPropertyValue(cssVar) ?? "";
  return {
    tokens: resolveSphereRenderTokens(read),
    palette: resolveSphereRenderPalette(read),
  };
}

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "sphere-render-style-v1";

export function createSphereRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_SPHERE_RENDER_PALETTE,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_SPHERE_RENDER_TOKENS,
}: {
  revision?: SphereStyleRevision;
  palette?: SphereRenderPalette;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<SphereRenderTokens>;
} = {}): SphereRenderStyle {
  const fontMetric = (prefix: "body" | "sign" | "house" | "decan" | "bound"): SphereFontMetric => ({
    min: tokens[`${prefix}FontMin`],
    max: tokens[`${prefix}FontMax`],
    divisor: tokens[`${prefix}FontDivisor`],
  });
  return deepFreeze({
    schemaVersion: SPHERE_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: { ...palette },
    typography: {
      fontUi,
      fontSymbols,
      body: fontMetric("body"),
      sign: fontMetric("sign"),
      house: fontMetric("house"),
      decan: fontMetric("decan"),
      bound: fontMetric("bound"),
    },
    strokes: {
      frameWidthMin: tokens.frameWidthMin,
      frameWidthDivisor: tokens.frameWidthDivisor,
      polylineWidthMin: tokens.polylineWidthMin,
      widthScaleMin: tokens.widthScaleMin,
      widthScaleDivisor: tokens.widthScaleDivisor,
      dotRadiusMin: tokens.dotRadiusMin,
      dotRadiusDivisor: tokens.dotRadiusDivisor,
      lineCap: "butt" as const,
      lineJoin: "miter" as const,
    },
    layout: { radiusScale: tokens.radiusScale },
    opacities: {
      referenceTick: { front: tokens.referenceTickFrontOpacity, back: tokens.referenceTickBackOpacity },
      reference: { front: tokens.referenceFrontOpacity, back: tokens.referenceBackOpacity },
      signBoundary: { front: tokens.signBoundaryFrontOpacity, back: tokens.signBoundaryBackOpacity },
      decanBoundary: { front: tokens.decanBoundaryFrontOpacity, back: tokens.decanBoundaryBackOpacity },
      houseBoundary: { front: tokens.houseBoundaryFrontOpacity, back: tokens.houseBoundaryBackOpacity },
      boundTick: { front: tokens.boundTickFrontOpacity, back: tokens.boundTickBackOpacity },
      body: { front: tokens.bodyFrontOpacity, back: tokens.bodyBackOpacity },
      signLabel: { front: tokens.signLabelFrontOpacity, back: tokens.signLabelBackOpacity },
      houseLabel: { front: tokens.houseLabelFrontOpacity, back: tokens.houseLabelBackOpacity },
      decanLabel: tokens.decanLabelOpacity,
      boundLabel: tokens.boundLabelOpacity,
    },
  });
}

/** Resolve one immutable paint snapshot from one computed-style read. */
export function resolveSphereRenderStyle(
  host: HTMLElement | null,
  input: Omit<Parameters<typeof createSphereRenderStyle>[0], "tokens" | "palette"> = {},
): SphereRenderStyle {
  const { tokens, palette } = readSphereRenderValues(host);
  return createSphereRenderStyle({ ...input, tokens, palette });
}

export function resolveSphereFontSize(metric: SphereFontMetric, radius: number): number {
  return Math.max(metric.min, Math.min(metric.max, radius / metric.divisor));
}

export function resolveSphereRadius(
  style: SphereRenderStyle,
  width: number,
  height: number,
  zoom: number,
): number {
  return Math.min(width, height) * style.layout.radiusScale * zoom;
}

export function resolveSphereFrameWidth(style: SphereRenderStyle, radius: number): number {
  return Math.max(style.strokes.frameWidthMin, radius / style.strokes.frameWidthDivisor);
}

export function resolveSpherePolylineWidth(
  style: SphereRenderStyle,
  radius: number,
  payloadWidth: number,
): number {
  const widthScale = Math.max(style.strokes.widthScaleMin, radius / style.strokes.widthScaleDivisor);
  return Math.max(style.strokes.polylineWidthMin, payloadWidth * widthScale);
}

export function resolveSphereDotRadius(style: SphereRenderStyle, radius: number): number {
  return Math.max(style.strokes.dotRadiusMin, radius / style.strokes.dotRadiusDivisor);
}
