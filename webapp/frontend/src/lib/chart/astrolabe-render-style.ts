// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const ASTROLABE_RENDER_STYLE_SCHEMA_VERSION = 3 as const;

export type AstrolabeStyleRevision = string | number;

export type AstrolabeRenderPalette = Readonly<{
  background: string;
  horizon: string;
  ecliptic: string;
  equator: string;
  equatorLabel: string;
  tropic: string;
  meridian: string;
  regio: string;
  almucantar: string;
  azimuth: string;
  hour: string;
  capricorn: string;
  star: string;
  cardinal: string;
  sunFill: string;
  infoAtmospheric: string;
  infoSchematic: string;
}>;

export type AstrolabeRenderTokens = {
  capricornFill: number;
  fineStrokeMin: number;
  fineStrokeDivisor: number;
  mediumStrokeMin: number;
  mediumStrokeDivisor: number;
  mainStrokeMin: number;
  mainStrokeDivisor: number;
  tropicDashOn: number;
  tropicDashOff: number;
  equatorDashOn: number;
  equatorDashOff: number;
  regioDashOn: number;
  regioDashOff: number;
  meridianDashOn: number;
  meridianDashOff: number;
  capricornDashOn: number;
  capricornDashOff: number;
  connectorDashOn: number;
  connectorDashOff: number;
  connectorOpacity: number;
  atmosphericFillOpacity: number;
  sphereOutlineWidth: number;
  bandWidthScale: number;
  tickStepScale: number;
  innerRadiusMin: number;
  starRadiusMin: number;
  starRadiusDivisor: number;
  signFontDivisor: number;
  signCullScale: number;
  sphereRadiusMin: number;
  sphereRadiusDivisor: number;
  planetFontDivisor: number;
  bodyLabelPadScale: number;
  bodyCullScale: number;
  collisionMarginScale: number;
  collisionIterations: number;
  collisionMinDelta: number;
  collisionTieDelta: number;
  collisionPushScale: number;
  collisionMoveScale: number;
  sunSphereScale: number;
  circleLabelFontDivisor: number;
  circleLabelOffsetX: number;
  circleLabelOffsetY: number;
  cardinalPadScale: number;
  cardinalFontDivisor: number;
  infoFontDivisor: number;
  infoFontScale: number;
  infoInsetDivisor: number;
  infoLineHeightScale: number;
  pdRowFontDivisor: number;
  pdRowHeightScale: number;
  pdTokenGapScale: number;
};

type AstrolabeRenderTokenSpecs = {
  readonly [K in keyof AstrolabeRenderTokens]: readonly [cssVar: string, fallback: number];
};

type AstrolabePaletteSpecs = {
  readonly [K in keyof AstrolabeRenderPalette]: readonly [cssVar: string, fallback: string];
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

export const ASTROLABE_RENDER_TOKEN_SPECS: Readonly<AstrolabeRenderTokenSpecs> = deepFreeze({
  capricornFill: ["--aries-astrolabe-capricorn-fill", 0.83],
  fineStrokeMin: ["--aries-astrolabe-fine-stroke-min", 0.75],
  fineStrokeDivisor: ["--aries-astrolabe-fine-stroke-divisor", 960],
  mediumStrokeMin: ["--aries-astrolabe-medium-stroke-min", 1],
  mediumStrokeDivisor: ["--aries-astrolabe-medium-stroke-divisor", 720],
  mainStrokeMin: ["--aries-astrolabe-main-stroke-min", 1.5],
  mainStrokeDivisor: ["--aries-astrolabe-main-stroke-divisor", 720],
  tropicDashOn: ["--aries-astrolabe-tropic-dash-on", 1],
  tropicDashOff: ["--aries-astrolabe-tropic-dash-off", 3],
  equatorDashOn: ["--aries-astrolabe-equator-dash-on", 1],
  equatorDashOff: ["--aries-astrolabe-equator-dash-off", 3],
  regioDashOn: ["--aries-astrolabe-regio-dash-on", 1],
  regioDashOff: ["--aries-astrolabe-regio-dash-off", 4],
  meridianDashOn: ["--aries-astrolabe-meridian-dash-on", 2],
  meridianDashOff: ["--aries-astrolabe-meridian-dash-off", 4],
  capricornDashOn: ["--aries-astrolabe-capricorn-dash-on", 1],
  capricornDashOff: ["--aries-astrolabe-capricorn-dash-off", 2],
  connectorDashOn: ["--aries-astrolabe-connector-dash-on", 1],
  connectorDashOff: ["--aries-astrolabe-connector-dash-off", 3],
  connectorOpacity: ["--aries-astrolabe-connector-opacity", 0.42],
  atmosphericFillOpacity: ["--aries-astrolabe-atmospheric-fill-opacity", 0.32],
  sphereOutlineWidth: ["--aries-astrolabe-sphere-outline-width", 0.75],
  bandWidthScale: ["--aries-astrolabe-band-width-scale", 0.12],
  tickStepScale: ["--aries-astrolabe-tick-step-scale", 0.008],
  innerRadiusMin: ["--aries-astrolabe-inner-radius-min", 1],
  starRadiusMin: ["--aries-astrolabe-star-radius-min", 1],
  starRadiusDivisor: ["--aries-astrolabe-star-radius-divisor", 360],
  signFontDivisor: ["--aries-astrolabe-sign-font-divisor", 24],
  signCullScale: ["--aries-astrolabe-sign-cull-scale", 0.03],
  sphereRadiusMin: ["--aries-astrolabe-sphere-radius-min", 1.5],
  sphereRadiusDivisor: ["--aries-astrolabe-sphere-radius-divisor", 190],
  planetFontDivisor: ["--aries-astrolabe-planet-font-divisor", 18],
  bodyLabelPadScale: ["--aries-astrolabe-body-label-pad-scale", 0.018],
  bodyCullScale: ["--aries-astrolabe-body-cull-scale", 1.1],
  collisionMarginScale: ["--aries-astrolabe-collision-margin-scale", 0.15],
  collisionIterations: ["--aries-astrolabe-collision-iterations", 40],
  collisionMinDelta: ["--aries-astrolabe-collision-min-delta", 0.5],
  collisionTieDelta: ["--aries-astrolabe-collision-tie-delta", 1],
  collisionPushScale: ["--aries-astrolabe-collision-push-scale", 0.5],
  collisionMoveScale: ["--aries-astrolabe-collision-move-scale", 0.5],
  sunSphereScale: ["--aries-astrolabe-sun-sphere-scale", 1.5],
  circleLabelFontDivisor: ["--aries-astrolabe-circle-label-font-divisor", 36],
  circleLabelOffsetX: ["--aries-astrolabe-circle-label-offset-x", 4],
  circleLabelOffsetY: ["--aries-astrolabe-circle-label-offset-y", 2],
  cardinalPadScale: ["--aries-astrolabe-cardinal-pad-scale", 0.04],
  cardinalFontDivisor: ["--aries-astrolabe-cardinal-font-divisor", 24],
  infoFontDivisor: ["--aries-astrolabe-info-font-divisor", 16],
  infoFontScale: ["--aries-astrolabe-info-font-scale", 0.75],
  infoInsetDivisor: ["--aries-astrolabe-info-inset-divisor", 25],
  infoLineHeightScale: ["--aries-astrolabe-info-line-height-scale", 1.2],
  pdRowFontDivisor: ["--aries-astrolabe-pd-row-font-divisor", 30],
  pdRowHeightScale: ["--aries-astrolabe-pd-row-height-scale", 1.3],
  pdTokenGapScale: ["--aries-astrolabe-pd-token-gap-scale", 0.35],
});

export const ASTROLABE_RENDER_PALETTE_SPECS: Readonly<AstrolabePaletteSpecs> = deepFreeze({
  background: ["--aries-astrolabe-background", "var(--morinus-background)"],
  horizon: ["--aries-astrolabe-horizon", "var(--morinus-angles)"],
  ecliptic: ["--aries-astrolabe-ecliptic", "var(--morinus-frame)"],
  equator: ["--aries-astrolabe-equator", "var(--morinus-houses)"],
  equatorLabel: ["--aries-astrolabe-equator-label", "var(--morinus-houses)"],
  tropic: ["--aries-astrolabe-tropic", "var(--morinus-houses)"],
  meridian: ["--aries-astrolabe-meridian", "var(--morinus-angles)"],
  regio: ["--aries-astrolabe-regio", "var(--morinus-houses)"],
  almucantar: ["--aries-astrolabe-almucantar", "var(--morinus-houses)"],
  azimuth: ["--aries-astrolabe-azimuth", "var(--morinus-houses)"],
  hour: ["--aries-astrolabe-hour", "var(--morinus-angles)"],
  capricorn: ["--aries-astrolabe-capricorn", "var(--morinus-frame)"],
  star: ["--aries-astrolabe-star", "var(--morinus-positions)"],
  cardinal: ["--aries-astrolabe-cardinal", "var(--morinus-angles)"],
  sunFill: ["--aries-astrolabe-sun-fill", "var(--morinus-body-sun)"],
  infoAtmospheric: ["--aries-astrolabe-info-atmospheric", "var(--morinus-text-bright)"],
  infoSchematic: ["--aries-astrolabe-info-schematic", "var(--morinus-text-bright)"],
});

const ASTROLABE_RENDER_PALETTE_OPACITY: Readonly<Record<keyof AstrolabeRenderPalette, number>> = deepFreeze({
  background: 1,
  horizon: 0.86,
  ecliptic: 1,
  equator: 0.78,
  equatorLabel: 1,
  tropic: 0.58,
  meridian: 0.62,
  regio: 0.46,
  almucantar: 0.34,
  azimuth: 0.28,
  hour: 0.25,
  capricorn: 1,
  star: 0.88,
  cardinal: 1,
  sunFill: 1,
  infoAtmospheric: 1,
  infoSchematic: 1,
});

const CHART_COLOR_FALLBACKS: Readonly<Record<string, string>> = deepFreeze({
  "--morinus-background": "rgb(35 36 40)",
  "--morinus-text-bright": "rgb(255 255 255)",
  "--morinus-frame": "rgb(220 220 221)",
  "--morinus-angles": "rgb(205 205 209)",
  "--morinus-houses": "rgb(138 139 141)",
  "--morinus-positions": "rgb(255 255 255)",
  "--morinus-body-sun": "rgb(255 215 0)",
});

const CSS_VAR_ALIAS = /^var\((--[a-z0-9-]+)\)$/;

function resolveColorAlias(
  value: string,
  readCssValue: AstrolabeCssValueReader,
  seen: ReadonlySet<string> = new Set(),
): string {
  const match = CSS_VAR_ALIAS.exec(value.trim());
  if (!match) return value.trim();
  const cssVar = match[1];
  if (seen.has(cssVar)) return CHART_COLOR_FALLBACKS[cssVar] ?? "rgb(205 205 209)";
  const next = readCssValue(cssVar).trim() || CHART_COLOR_FALLBACKS[cssVar] || "";
  return next
    ? resolveColorAlias(next, readCssValue, new Set([...seen, cssVar]))
    : "rgb(205 205 209)";
}

function colorWithOpacity(value: string, opacity: number): string {
  if (opacity >= 1) return value;
  const percent = Number((opacity * 100).toFixed(4));
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const channels = [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16));
    return `rgb(${channels[0]} ${channels[1]} ${channels[2]} / ${percent}%)`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)(?:\s+|,\s*)([\d.]+)(?:\s+|,\s*)([\d.]+)(?:\s*(?:\/|,)\s*([\d.]+)%?)?\s*\)$/i.exec(value.trim());
  if (!rgb) return value;
  const existingOpacity = rgb[4]
    ? Math.min(1, Math.max(0, Number(rgb[4]) / (value.includes("%") ? 100 : 1)))
    : 1;
  const combinedPercent = Number((existingOpacity * opacity * 100).toFixed(4));
  return `rgb(${rgb[1]} ${rgb[2]} ${rgb[3]} / ${combinedPercent}%)`;
}

function defaultRenderTokens(): Readonly<AstrolabeRenderTokens> {
  const tokens = {} as AstrolabeRenderTokens;
  for (const key of Object.keys(ASTROLABE_RENDER_TOKEN_SPECS) as Array<keyof AstrolabeRenderTokens>) {
    tokens[key] = ASTROLABE_RENDER_TOKEN_SPECS[key][1];
  }
  return deepFreeze(tokens);
}

function defaultRenderPalette(): AstrolabeRenderPalette {
  return resolveAstrolabeRenderPalette();
}

export const DEFAULT_ASTROLABE_RENDER_TOKENS = defaultRenderTokens();
export const DEFAULT_ASTROLABE_RENDER_PALETTE = defaultRenderPalette();

export interface AstrolabeRenderStyle {
  readonly schemaVersion: typeof ASTROLABE_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: AstrolabeStyleRevision;
  readonly palette: AstrolabeRenderPalette;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    signFontDivisor: number;
    planetFontDivisor: number;
    circleLabelFontDivisor: number;
    cardinalFontDivisor: number;
    infoFontDivisor: number;
    infoFontScale: number;
    pdRowFontDivisor: number;
  }>;
  readonly strokes: Readonly<{
    fine: Readonly<{ min: number; divisor: number }>;
    medium: Readonly<{ min: number; divisor: number }>;
    main: Readonly<{ min: number; divisor: number }>;
    dashes: Readonly<{
      tropic: readonly [number, number];
      equator: readonly [number, number];
      regio: readonly [number, number];
      meridian: readonly [number, number];
      capricorn: readonly [number, number];
      connector: readonly [number, number];
    }>;
    connectorOpacity: number;
    sphereOutlineWidth: number;
  }>;
  readonly effects: Readonly<{
    atmosphericFillOpacity: number;
  }>;
  readonly layout: Readonly<{
    capricornFill: number;
    bandWidthScale: number;
    tickStepScale: number;
    innerRadiusMin: number;
    signCullScale: number;
    bodyLabelPadScale: number;
    bodyCullScale: number;
    circleLabelOffsetX: number;
    circleLabelOffsetY: number;
    cardinalPadScale: number;
    infoInsetDivisor: number;
    infoLineHeightScale: number;
    pdRowHeightScale: number;
    pdTokenGapScale: number;
  }>;
  readonly markers: Readonly<{
    starRadiusMin: number;
    starRadiusDivisor: number;
    sphereRadiusMin: number;
    sphereRadiusDivisor: number;
    sunSphereScale: number;
  }>;
  readonly collision: Readonly<{
    marginScale: number;
    iterations: number;
    minDelta: number;
    tieDelta: number;
    pushScale: number;
    moveScale: number;
  }>;
}

export type AstrolabeCssValueReader = (cssVar: string) => string;

const POSITIVE_TOKEN_KEYS = new Set<keyof AstrolabeRenderTokens>([
  "capricornFill",
  "fineStrokeDivisor",
  "mediumStrokeDivisor",
  "mainStrokeDivisor",
  "starRadiusDivisor",
  "signFontDivisor",
  "sphereRadiusDivisor",
  "planetFontDivisor",
  "bodyCullScale",
  "collisionIterations",
  "sunSphereScale",
  "circleLabelFontDivisor",
  "cardinalFontDivisor",
  "infoFontDivisor",
  "infoInsetDivisor",
  "pdRowFontDivisor",
]);

const OPACITY_TOKEN_KEYS = new Set<keyof AstrolabeRenderTokens>([
  "connectorOpacity",
  "atmosphericFillOpacity",
]);

export function resolveAstrolabeRenderTokens(
  readCssValue: AstrolabeCssValueReader = () => "",
): Readonly<AstrolabeRenderTokens> {
  const tokens = {} as AstrolabeRenderTokens;
  for (const key of Object.keys(ASTROLABE_RENDER_TOKEN_SPECS) as Array<keyof AstrolabeRenderTokens>) {
    const [cssVar, fallback] = ASTROLABE_RENDER_TOKEN_SPECS[key];
    const value = Number.parseFloat(readCssValue(cssVar).trim());
    const valid = Number.isFinite(value)
      && (POSITIVE_TOKEN_KEYS.has(key) ? value > 0 : value >= 0)
      && (!OPACITY_TOKEN_KEYS.has(key) || value <= 1);
    tokens[key] = valid ? value : fallback;
  }
  tokens.collisionIterations = Math.max(1, Math.round(tokens.collisionIterations));
  return deepFreeze(tokens);
}

export function resolveAstrolabeRenderPalette(
  readCssValue: AstrolabeCssValueReader = () => "",
): AstrolabeRenderPalette {
  const palette = {} as Record<keyof AstrolabeRenderPalette, string>;
  for (const key of Object.keys(ASTROLABE_RENDER_PALETTE_SPECS) as Array<keyof AstrolabeRenderPalette>) {
    const [cssVar, chartAlias] = ASTROLABE_RENDER_PALETTE_SPECS[key];
    const candidate = readCssValue(cssVar).trim() || chartAlias;
    const resolved = resolveColorAlias(candidate, readCssValue);
    palette[key] = candidate.startsWith("var(")
      ? colorWithOpacity(resolved, ASTROLABE_RENDER_PALETTE_OPACITY[key])
      : resolved;
  }
  return deepFreeze(palette) as AstrolabeRenderPalette;
}

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "astrolabe-render-style-v3";

export type AstrolabeRenderStyleInput = {
  revision?: AstrolabeStyleRevision;
  palette?: AstrolabeRenderPalette;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<AstrolabeRenderTokens>;
};

export function createAstrolabeRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_ASTROLABE_RENDER_PALETTE,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_ASTROLABE_RENDER_TOKENS,
}: AstrolabeRenderStyleInput = {}): AstrolabeRenderStyle {
  return deepFreeze({
    schemaVersion: ASTROLABE_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: { ...palette },
    typography: {
      fontUi,
      fontSymbols,
      signFontDivisor: tokens.signFontDivisor,
      planetFontDivisor: tokens.planetFontDivisor,
      circleLabelFontDivisor: tokens.circleLabelFontDivisor,
      cardinalFontDivisor: tokens.cardinalFontDivisor,
      infoFontDivisor: tokens.infoFontDivisor,
      infoFontScale: tokens.infoFontScale,
      pdRowFontDivisor: tokens.pdRowFontDivisor,
    },
    strokes: {
      fine: { min: tokens.fineStrokeMin, divisor: tokens.fineStrokeDivisor },
      medium: { min: tokens.mediumStrokeMin, divisor: tokens.mediumStrokeDivisor },
      main: { min: tokens.mainStrokeMin, divisor: tokens.mainStrokeDivisor },
      dashes: {
        tropic: [tokens.tropicDashOn, tokens.tropicDashOff] as const,
        equator: [tokens.equatorDashOn, tokens.equatorDashOff] as const,
        regio: [tokens.regioDashOn, tokens.regioDashOff] as const,
        meridian: [tokens.meridianDashOn, tokens.meridianDashOff] as const,
        capricorn: [tokens.capricornDashOn, tokens.capricornDashOff] as const,
        connector: [tokens.connectorDashOn, tokens.connectorDashOff] as const,
      },
      connectorOpacity: tokens.connectorOpacity,
      sphereOutlineWidth: tokens.sphereOutlineWidth,
    },
    effects: {
      atmosphericFillOpacity: tokens.atmosphericFillOpacity,
    },
    layout: {
      capricornFill: tokens.capricornFill,
      bandWidthScale: tokens.bandWidthScale,
      tickStepScale: tokens.tickStepScale,
      innerRadiusMin: tokens.innerRadiusMin,
      signCullScale: tokens.signCullScale,
      bodyLabelPadScale: tokens.bodyLabelPadScale,
      bodyCullScale: tokens.bodyCullScale,
      circleLabelOffsetX: tokens.circleLabelOffsetX,
      circleLabelOffsetY: tokens.circleLabelOffsetY,
      cardinalPadScale: tokens.cardinalPadScale,
      infoInsetDivisor: tokens.infoInsetDivisor,
      infoLineHeightScale: tokens.infoLineHeightScale,
      pdRowHeightScale: tokens.pdRowHeightScale,
      pdTokenGapScale: tokens.pdTokenGapScale,
    },
    markers: {
      starRadiusMin: tokens.starRadiusMin,
      starRadiusDivisor: tokens.starRadiusDivisor,
      sphereRadiusMin: tokens.sphereRadiusMin,
      sphereRadiusDivisor: tokens.sphereRadiusDivisor,
      sunSphereScale: tokens.sunSphereScale,
    },
    collision: {
      marginScale: tokens.collisionMarginScale,
      iterations: tokens.collisionIterations,
      minDelta: tokens.collisionMinDelta,
      tieDelta: tokens.collisionTieDelta,
      pushScale: tokens.collisionPushScale,
      moveScale: tokens.collisionMoveScale,
    },
  }) as AstrolabeRenderStyle;
}

export function resolveAstrolabeRenderStyle(
  host: HTMLElement | null,
  input: Omit<AstrolabeRenderStyleInput, "palette" | "tokens"> = {},
): AstrolabeRenderStyle {
  const computed = host ? window.getComputedStyle(host) : null;
  const read = (cssVar: string) => computed?.getPropertyValue(cssVar) ?? "";
  return createAstrolabeRenderStyle({
    ...input,
    tokens: resolveAstrolabeRenderTokens(read),
    palette: resolveAstrolabeRenderPalette(read),
  });
}

export type AstrolabeStrokeWidths = Readonly<{ fine: number; medium: number; main: number }>;

/** Smooth CSS-pixel stroke hierarchy: etched plate, rete, then structural rim. */
export function resolveAstrolabeStrokeWidths(
  style: AstrolabeRenderStyle,
  size: number,
): AstrolabeStrokeWidths {
  const width = (minimum: number, divisor: number) => (
    Math.round(Math.max(minimum, size / divisor) * 100) / 100
  );
  return deepFreeze({
    fine: width(style.strokes.fine.min, style.strokes.fine.divisor),
    medium: width(style.strokes.medium.min, style.strokes.medium.divisor),
    main: width(style.strokes.main.min, style.strokes.main.divisor),
  });
}
