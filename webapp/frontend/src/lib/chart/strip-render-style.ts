// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const STRIP_RENDER_STYLE_SCHEMA_VERSION = 1 as const;

export type StripStyleRevision = string | number;

export type StripRenderPalette = Readonly<{
  background: string;
  axis: string;
  textPrimary: string;
  textMuted: string;
}>;

export type StripRenderTokens = {
  fontSize: number;
  emptyFontSize: number;
  notesFontSize: number;
  border: number;
  collisionGapScale: number;
  planetOffsetScale: number;
  connectorLengthScale: number;
  longTickScale: number;
  fiveTickScale: number;
  oneTickScale: number;
  tickStepScale: number;
  degreeLabelOffsetScale: number;
  textGlyphWidthScale: number;
  axisStrokeWidth: number;
  connectorStrokeWidth: number;
  containerPadding: number;
  notesGap: number;
};

type StripRenderTokenSpecs = {
  readonly [K in keyof StripRenderTokens]: readonly [cssVar: string, fallback: number];
};

type StripRenderPaletteSpecs = {
  readonly [K in keyof StripRenderPalette]: readonly [cssVar: string, fallback: string];
};

function freezeTokenSpecs(specs: StripRenderTokenSpecs): Readonly<StripRenderTokenSpecs> {
  for (const spec of Object.values(specs)) Object.freeze(spec);
  return Object.freeze(specs);
}

export const STRIP_RENDER_TOKEN_SPECS = freezeTokenSpecs({
  fontSize: ["--aries-strip-font-size", 21],
  emptyFontSize: ["--aries-font-size-base", 12],
  notesFontSize: ["--aries-font-size-small", 11],
  border: ["--aries-strip-border", 20],
  collisionGapScale: ["--aries-strip-collision-gap-scale", 0.2],
  planetOffsetScale: ["--aries-strip-planet-offset-scale", 0.4],
  connectorLengthScale: ["--aries-strip-connector-length-scale", 0.7],
  longTickScale: ["--aries-strip-long-tick-scale", 2 / 3],
  fiveTickScale: ["--aries-strip-five-tick-scale", 0.7],
  oneTickScale: ["--aries-strip-one-tick-scale", 0.4],
  tickStepScale: ["--aries-strip-tick-step-scale", 4 / 3],
  degreeLabelOffsetScale: ["--aries-strip-degree-label-offset-scale", 0.2],
  textGlyphWidthScale: ["--aries-strip-text-glyph-width-scale", 0.62],
  axisStrokeWidth: ["--aries-strip-axis-stroke-width", 1],
  connectorStrokeWidth: ["--aries-strip-connector-stroke-width", 1],
  containerPadding: ["--aries-strip-container-padding", 16],
  notesGap: ["--aries-strip-notes-gap", 12],
});

function freezePaletteSpecs(
  specs: StripRenderPaletteSpecs,
): Readonly<StripRenderPaletteSpecs> {
  for (const spec of Object.values(specs)) Object.freeze(spec);
  return Object.freeze(specs);
}

/** Strip-specific roles preserve the established appearance while moving
 * chart paint completely out of application chrome tokens. */
export const STRIP_RENDER_PALETTE_SPECS = freezePaletteSpecs({
  background: ["--aries-strip-background", "#232428"],
  axis: ["--aries-strip-axis", "#2e2f32"],
  textPrimary: ["--aries-strip-text-primary", "#ffffff"],
  textMuted: ["--aries-strip-text-muted", "#b4b5b6"],
});

/** Generic chart roles which are semantically exact bases for Strip paint.
 * Only active profile overrides use this inheritance seam; ordinary fallback
 * CSS keeps the established Strip defaults above. */
export const STRIP_RENDER_BASE_PALETTE_ROLES = Object.freeze({
  background: "--morinus-background",
  axis: "--morinus-frame",
  textPrimary: "--morinus-text-bright",
  textMuted: "--morinus-text-dim",
} as const satisfies Readonly<Record<keyof StripRenderPalette, string>>);

/** The settled Strip surface inherited application colors before profiles
 * existed. Keep that no-profile/default authority so Day and custom app
 * palettes do not fall back to fixed Midnight colors. */
export const STRIP_RETAINED_APP_PALETTE_ROLES = Object.freeze({
  background: "--aries-background",
  axis: "--aries-border-subtle",
  textPrimary: "--aries-text-primary",
  textMuted: "--aries-text-muted",
} as const satisfies Readonly<Record<keyof StripRenderPalette, string>>);

const POSITIVE_TOKEN_KEYS = new Set<keyof StripRenderTokens>([
  "fontSize",
  "emptyFontSize",
  "notesFontSize",
  "border",
  "tickStepScale",
]);

function defaultRenderTokens(): Readonly<StripRenderTokens> {
  const tokens = {} as StripRenderTokens;
  for (const key of Object.keys(STRIP_RENDER_TOKEN_SPECS) as Array<keyof StripRenderTokens>) {
    tokens[key] = STRIP_RENDER_TOKEN_SPECS[key][1];
  }
  return Object.freeze(tokens);
}

export const DEFAULT_STRIP_RENDER_TOKENS = defaultRenderTokens();

function defaultRenderPalette(): StripRenderPalette {
  const palette = {} as Record<keyof StripRenderPalette, string>;
  for (const key of Object.keys(STRIP_RENDER_PALETTE_SPECS) as Array<keyof StripRenderPalette>) {
    palette[key] = STRIP_RENDER_PALETTE_SPECS[key][1];
  }
  return Object.freeze(palette) as StripRenderPalette;
}

export const DEFAULT_STRIP_RENDER_PALETTE = defaultRenderPalette();

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "strip-render-style-v1";
const STRIP_DEGREES = 30;

export interface StripRenderStyle {
  readonly schemaVersion: typeof STRIP_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: StripStyleRevision;
  readonly palette: StripRenderPalette;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    fontSize: number;
    emptyFontSize: number;
    notesFontSize: number;
    textGlyphWidthScale: number;
  }>;
  readonly strokes: Readonly<{
    axis: number;
    connector: number;
  }>;
  readonly layout: Readonly<{
    border: number;
    collisionGap: number;
    planetOffset: number;
    connectorLength: number;
    longTick: number;
    fiveTick: number;
    oneTick: number;
    tickStep: number;
    degreeLabelOffset: number;
    axisWidth: number;
    degreePx: number;
    axisY: number;
    glyphTop: number;
    glyphConnectY: number;
    labelY: number;
    stripWidth: number;
    stripHeight: number;
    containerPadding: number;
    notesGap: number;
  }>;
}

export type StripCssValueReader = (cssVar: string) => string;
export type StripChartProfileOverrides = Readonly<Record<string, string>>;

export function resolveStripRenderTokens(
  readCssValue: StripCssValueReader = () => "",
): Readonly<StripRenderTokens> {
  const tokens = {} as StripRenderTokens;
  for (const key of Object.keys(STRIP_RENDER_TOKEN_SPECS) as Array<keyof StripRenderTokens>) {
    const [cssVar, fallback] = STRIP_RENDER_TOKEN_SPECS[key];
    const value = Number.parseFloat(readCssValue(cssVar).trim());
    const valid = Number.isFinite(value) && (POSITIVE_TOKEN_KEYS.has(key) ? value > 0 : value >= 0);
    tokens[key] = valid ? value : fallback;
  }
  return Object.freeze(tokens);
}

/** Resolve profile authority without inheriting app chrome. A Strip-specific
 * override wins; then an exact generic chart role; then the retained Strip CSS
 * fallback. Passing an empty override map models profile deactivation. */
export function resolveStripRenderPalette(
  readCssValue: StripCssValueReader = () => "",
  profileOverrides: StripChartProfileOverrides = {},
): StripRenderPalette {
  const palette = {} as Record<keyof StripRenderPalette, string>;
  for (const key of Object.keys(STRIP_RENDER_PALETTE_SPECS) as Array<keyof StripRenderPalette>) {
    const [cssVar, fallback] = STRIP_RENDER_PALETTE_SPECS[key];
    const explicitProfileValue = profileOverrides[cssVar]?.trim();
    const baseProfileValue = profileOverrides[STRIP_RENDER_BASE_PALETTE_ROLES[key]]?.trim();
    const retainedAppValue = readCssValue(STRIP_RETAINED_APP_PALETTE_ROLES[key]).trim();
    palette[key] =
      explicitProfileValue ||
      baseProfileValue ||
      retainedAppValue ||
      readCssValue(cssVar).trim() ||
      fallback;
  }
  return Object.freeze(palette) as StripRenderPalette;
}

function createStripLayout(tokens: Readonly<StripRenderTokens>): StripRenderStyle["layout"] {
  const fontSize = tokens.fontSize;
  const collisionGap = fontSize * tokens.collisionGapScale;
  const planetOffset = fontSize * tokens.planetOffsetScale;
  const connectorLength = fontSize * tokens.connectorLengthScale;
  const longTick = fontSize * tokens.longTickScale;
  const fiveTick = fontSize * tokens.fiveTickScale;
  const oneTick = fontSize * tokens.oneTickScale;
  const tickStep = fontSize * tokens.tickStepScale;
  const degreeLabelOffset = fontSize * tokens.degreeLabelOffsetScale;
  const axisWidth = STRIP_DEGREES * tickStep;
  const degreePx = axisWidth / STRIP_DEGREES;
  const axisY = tokens.border + fontSize + planetOffset + connectorLength;
  const glyphTop = tokens.border;
  const glyphConnectY = glyphTop + fontSize + planetOffset;
  const labelY = axisY + longTick + degreeLabelOffset;
  const stripWidth = tokens.border + axisWidth + tokens.border;
  const stripHeight = Math.ceil(
    tokens.border + longTick + degreeLabelOffset + fontSize + axisY,
  );
  return Object.freeze({
    border: tokens.border,
    collisionGap,
    planetOffset,
    connectorLength,
    longTick,
    fiveTick,
    oneTick,
    tickStep,
    degreeLabelOffset,
    axisWidth,
    degreePx,
    axisY,
    glyphTop,
    glyphConnectY,
    labelY,
    stripWidth,
    stripHeight,
    containerPadding: tokens.containerPadding,
    notesGap: tokens.notesGap,
  });
}

export function createStripRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_STRIP_RENDER_PALETTE,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_STRIP_RENDER_TOKENS,
}: {
  revision?: StripStyleRevision;
  palette?: StripRenderPalette;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<StripRenderTokens>;
} = {}): StripRenderStyle {
  return Object.freeze({
    schemaVersion: STRIP_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: Object.freeze({ ...palette }),
    typography: Object.freeze({
      fontUi,
      fontSymbols,
      fontSize: tokens.fontSize,
      emptyFontSize: tokens.emptyFontSize,
      notesFontSize: tokens.notesFontSize,
      textGlyphWidthScale: tokens.textGlyphWidthScale,
    }),
    strokes: Object.freeze({
      axis: tokens.axisStrokeWidth,
      connector: tokens.connectorStrokeWidth,
    }),
    layout: createStripLayout(tokens),
  });
}

/** Resolve all semantic paint, fonts, and metrics from one computed-style read. */
export function resolveStripRenderStyle(
  host: HTMLElement | null,
  {
    revision = DEFAULT_REVISION,
    profileOverrides = {},
  }: {
    revision?: StripStyleRevision;
    profileOverrides?: StripChartProfileOverrides;
  } = {},
): StripRenderStyle {
  const computed = host ? window.getComputedStyle(host) : null;
  const read = (name: string) => computed?.getPropertyValue(name).trim() ?? "";
  const color = (name: string, fallback: string) => read(name) || fallback;
  return createStripRenderStyle({
    revision,
    palette: resolveStripRenderPalette(read, profileOverrides),
    fontUi: color("--aries-font-ui", DEFAULT_UI_FONT),
    fontSymbols: color("--aries-font-symbols", DEFAULT_SYMBOL_FONT),
    tokens: resolveStripRenderTokens(read),
  });
}
