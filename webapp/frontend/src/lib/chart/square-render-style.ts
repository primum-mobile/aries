// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const SQUARE_RENDER_STYLE_SCHEMA_VERSION = 1 as const;

export type SquareStyleRevision = string | number;

export type SquareRenderPalette = Readonly<{
  background: string;
  frame: string;
  texts: string;
  positions: string;
  signs: string;
}>;

export type SquareRenderTokens = {
  radiusScale: number;
  symbolFontDivisor: number;
  symbolFontMin: number;
  smallSymbolFontDivisor: number;
  smallSymbolFontMin: number;
  textFontMin: number;
  smallTextScale: number;
  smallerTextScale: number;
  spaceFontDivisor: number;
  frameSmallMax: number;
  frameMediumMax: number;
  frameOuterWidthSmall: number;
  frameOuterWidthMedium: number;
  frameOuterWidthLarge: number;
  frameInnerWidthSmall: number;
  frameInnerWidthMedium: number;
  frameInnerWidthLarge: number;
  infoRadiusDivisor: number;
  innerFramePixelAdjustment: number;
  motionBaselineScale: number;
};

type SquareRenderTokenSpecs = {
  readonly [K in keyof SquareRenderTokens]: readonly [cssVar: string, fallback: number];
};

function freezeTokenSpecs(specs: SquareRenderTokenSpecs): Readonly<SquareRenderTokenSpecs> {
  for (const spec of Object.values(specs)) Object.freeze(spec);
  return Object.freeze(specs);
}

export const SQUARE_RENDER_TOKEN_SPECS = freezeTokenSpecs({
  radiusScale: ["--aries-square-radius-scale", 0.9],
  symbolFontDivisor: ["--aries-square-symbol-font-divisor", 16],
  symbolFontMin: ["--aries-square-symbol-font-min", 8],
  smallSymbolFontDivisor: ["--aries-square-small-symbol-font-divisor", 18],
  smallSymbolFontMin: ["--aries-square-small-symbol-font-min", 6],
  textFontMin: ["--aries-square-text-font-min", 6],
  smallTextScale: ["--aries-square-small-text-scale", 0.75],
  smallerTextScale: ["--aries-square-smaller-text-scale", 0.5],
  spaceFontDivisor: ["--aries-square-space-font-divisor", 5],
  frameSmallMax: ["--aries-square-frame-small-max", 400],
  frameMediumMax: ["--aries-square-frame-medium-max", 600],
  frameOuterWidthSmall: ["--aries-square-frame-outer-width-small", 2],
  frameOuterWidthMedium: ["--aries-square-frame-outer-width-medium", 3],
  frameOuterWidthLarge: ["--aries-square-frame-outer-width-large", 4],
  frameInnerWidthSmall: ["--aries-square-frame-inner-width-small", 1],
  frameInnerWidthMedium: ["--aries-square-frame-inner-width-medium", 2],
  frameInnerWidthLarge: ["--aries-square-frame-inner-width-large", 3],
  infoRadiusDivisor: ["--aries-square-info-radius-divisor", 3],
  innerFramePixelAdjustment: ["--aries-square-inner-frame-pixel-adjustment", 1],
  motionBaselineScale: ["--aries-square-motion-baseline-scale", 0.5],
});

const POSITIVE_TOKEN_KEYS = new Set<keyof SquareRenderTokens>([
  "radiusScale",
  "symbolFontDivisor",
  "smallSymbolFontDivisor",
  "spaceFontDivisor",
  "frameSmallMax",
  "frameMediumMax",
  "infoRadiusDivisor",
]);

function defaultRenderTokens(): Readonly<SquareRenderTokens> {
  const tokens = {} as SquareRenderTokens;
  for (const key of Object.keys(SQUARE_RENDER_TOKEN_SPECS) as Array<keyof SquareRenderTokens>) {
    tokens[key] = SQUARE_RENDER_TOKEN_SPECS[key][1];
  }
  return Object.freeze(tokens);
}

export const DEFAULT_SQUARE_RENDER_TOKENS = defaultRenderTokens();

export const DEFAULT_SQUARE_RENDER_PALETTE: SquareRenderPalette = Object.freeze({
  background: "#232428",
  frame: "#dcdcdd",
  texts: "#98999c",
  positions: "#ffffff",
  signs: "#d7d7d9",
});

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "square-render-style-v1";

export interface SquareRenderStyle {
  readonly schemaVersion: typeof SQUARE_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: SquareStyleRevision;
  readonly palette: SquareRenderPalette;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    symbolFontDivisor: number;
    symbolFontMin: number;
    smallSymbolFontDivisor: number;
    smallSymbolFontMin: number;
    textFontMin: number;
    smallTextScale: number;
    smallerTextScale: number;
  }>;
  readonly strokes: Readonly<{
    smallMax: number;
    mediumMax: number;
    outerSmall: number;
    outerMedium: number;
    outerLarge: number;
    innerSmall: number;
    innerMedium: number;
    innerLarge: number;
  }>;
  readonly layout: Readonly<{
    radiusScale: number;
    spaceFontDivisor: number;
    infoRadiusDivisor: number;
    innerFramePixelAdjustment: number;
    motionBaselineScale: number;
  }>;
}

export type SquareCssValueReader = (cssVar: string) => string;

/** Resolve the declared numeric CSS inputs once before a paint. */
export function resolveSquareRenderTokens(
  readCssValue: SquareCssValueReader = () => "",
): Readonly<SquareRenderTokens> {
  const tokens = {} as SquareRenderTokens;
  for (const key of Object.keys(SQUARE_RENDER_TOKEN_SPECS) as Array<keyof SquareRenderTokens>) {
    const [cssVar, fallback] = SQUARE_RENDER_TOKEN_SPECS[key];
    const value = Number.parseFloat(readCssValue(cssVar).trim());
    const valid = Number.isFinite(value) && (POSITIVE_TOKEN_KEYS.has(key) ? value > 0 : value >= 0);
    tokens[key] = valid ? value : fallback;
  }
  return Object.freeze(tokens);
}

export function readSquareRenderTokens(
  host: HTMLElement | null,
): Readonly<SquareRenderTokens> {
  const computed = host ? window.getComputedStyle(host) : null;
  return resolveSquareRenderTokens((cssVar) => computed?.getPropertyValue(cssVar) ?? "");
}

export function createSquareRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_SQUARE_RENDER_PALETTE,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_SQUARE_RENDER_TOKENS,
}: {
  revision?: SquareStyleRevision;
  palette?: SquareRenderPalette;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<SquareRenderTokens>;
} = {}): SquareRenderStyle {
  return Object.freeze({
    schemaVersion: SQUARE_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: Object.freeze({ ...palette }),
    typography: Object.freeze({
      fontUi,
      fontSymbols,
      symbolFontDivisor: tokens.symbolFontDivisor,
      symbolFontMin: tokens.symbolFontMin,
      smallSymbolFontDivisor: tokens.smallSymbolFontDivisor,
      smallSymbolFontMin: tokens.smallSymbolFontMin,
      textFontMin: tokens.textFontMin,
      smallTextScale: tokens.smallTextScale,
      smallerTextScale: tokens.smallerTextScale,
    }),
    strokes: Object.freeze({
      smallMax: tokens.frameSmallMax,
      mediumMax: tokens.frameMediumMax,
      outerSmall: tokens.frameOuterWidthSmall,
      outerMedium: tokens.frameOuterWidthMedium,
      outerLarge: tokens.frameOuterWidthLarge,
      innerSmall: tokens.frameInnerWidthSmall,
      innerMedium: tokens.frameInnerWidthMedium,
      innerLarge: tokens.frameInnerWidthLarge,
    }),
    layout: Object.freeze({
      radiusScale: tokens.radiusScale,
      spaceFontDivisor: tokens.spaceFontDivisor,
      infoRadiusDivisor: tokens.infoRadiusDivisor,
      innerFramePixelAdjustment: tokens.innerFramePixelAdjustment,
      motionBaselineScale: tokens.motionBaselineScale,
    }),
  });
}

/** Resolve one immutable style snapshot shared by all Square paint helpers. */
export function resolveSquareRenderStyle(
  host: HTMLElement | null,
  input: Omit<Parameters<typeof createSquareRenderStyle>[0], "tokens"> = {},
): SquareRenderStyle {
  return createSquareRenderStyle({
    ...input,
    tokens: readSquareRenderTokens(host),
  });
}

export function resolveSquareFrameWidths(
  style: SquareRenderStyle,
  chartSize: number,
): Readonly<{ outer: number; inner: number }> {
  const strokes = style.strokes;
  if (chartSize <= strokes.smallMax) {
    return Object.freeze({ outer: strokes.outerSmall, inner: strokes.innerSmall });
  }
  if (chartSize <= strokes.mediumMax) {
    return Object.freeze({ outer: strokes.outerMedium, inner: strokes.innerMedium });
  }
  return Object.freeze({ outer: strokes.outerLarge, inner: strokes.innerLarge });
}

export interface SquareTypographyMetrics {
  readonly fontSize: number;
  readonly smallSymbolSize: number;
  readonly smallTextSize: number;
  readonly smallerTextSize: number;
  readonly space: number;
  readonly lineHeight: number;
}

/** Preserve the Square renderer's established radius-relative font rounding. */
export function resolveSquareTypographyMetrics(
  style: SquareRenderStyle,
  maxRadius: number,
): SquareTypographyMetrics {
  const typography = style.typography;
  const symbolSize = Math.max(
    typography.symbolFontMin,
    maxRadius / typography.symbolFontDivisor,
  );
  const smallSymbolSize = Math.max(
    typography.smallSymbolFontMin,
    maxRadius / typography.smallSymbolFontDivisor,
  );
  const fontSize = Math.max(typography.textFontMin, Math.round(symbolSize));
  const roundedSmallSymbolSize = Math.max(
    typography.textFontMin,
    Math.round(smallSymbolSize),
  );
  const smallTextSize = Math.max(
    typography.textFontMin,
    Math.round(typography.smallTextScale * fontSize),
  );
  const smallerTextSize = Math.max(
    typography.textFontMin,
    Math.round(typography.smallerTextScale * fontSize),
  );
  const space = fontSize / style.layout.spaceFontDivisor;
  return Object.freeze({
    fontSize,
    smallSymbolSize: roundedSmallSymbolSize,
    smallTextSize,
    smallerTextSize,
    space,
    lineHeight: space + fontSize + space,
  });
}
